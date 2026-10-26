// tools/tests/OrquestacionKpiHeadlessSmoke.js - las tarjetas KPI de
// Orquestacion que abren la lista de jobs (orquestacion/orquestacion.js,
// "KPI -> lista"), en un Chrome de verdad.
//
// NO forma parte del sitio. Sirve el repositorio con un servidor propio
// (solo 127.0.0.1, puerto libre) y en memoria una copia de
// orquestacion/orquestacion.html con dos agregados: un fetch de mentira
// (40 jobs; ?falla=1 hace fallar ?detalle=1) y una sonda que pulsa las
// tarjetas y apunta lo que ve. Chrome headless (--dump-dom) la abre y la
// prueba compara. No escribe nada en disco.
//
//   O1-O13  clic, reemplazo, quitar, desplegable, busqueda, filtros,
//           Universo, lista cerrada (O12: abre con la tarjeta, no la quita);
//   O14     ocultar la lista quita la marca al momento (y aria-pressed);
//           volver a abrirla con el boton la devuelve;
//   O15     la pagina baja a #orq-jobs tras el clic (lista abierta o recien
//           traida); ocultar no baja; el foco queda en la tarjeta;
//   F1-F3   si ?detalle=1 falla tras un clic: sin lista, sin marca, aviso
//           de error, no baja; el foco sigue en la tarjeta;
//   L1-L3   "Limpiar" con una tarjeta elegida (y con el desplegable cambiado
//           a mano despues): "Mostrar" vuelve a Todos, sin marca ni
//           aria-pressed, la lista con todos los jobs; la busqueda de la
//           lista se conserva (Limpiar nunca la toco).
//
// El servidor y el Chrome son los de tools/tests/BancoHeadless.js.
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\OrquestacionKpiHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
//
// Sin Chrome instalado dice SKIP y sale 0. Otra ruta: CHROME=<ruta>.
'use strict';
var fs = require('fs');
var path = require('path');
var Banco = require('./BancoHeadless');

var raiz = path.join(__dirname, '..', '..');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

if (!Banco.CHROME) { console.log('SKIP  sin Chrome/Edge (CHROME=<ruta> para indicar otro)'); process.exit(0); }

// ---- datos de mentira: 40 jobs, 8 huerfanos, 20 activos, 10 orquestados ----
var COLS = ['JobId', 'Dir', 'N3', 'Herramienta', 'Candidato', 'EsHuerfano', 'Activo', 'OrqCompleto',
            'CamposLlenosExcel', 'CamposLlenosEstricta', 'CandSi', 'PendMigrar', 'Prom'];
var filas = [], det = [];
for (var i = 1; i <= 40; i++) {
  var act = i % 2 === 0 ? 1 : 0;
  filas.push([i, i <= 20 ? 'Dir A' : 'Dir B', 'N3 ' + (i % 3), 'Herr ' + (i % 2), i % 3 === 0 ? 'Si' : 'No',
              i % 5 === 0 ? 1 : 0, act, act && i % 4 === 0 ? 1 : 0, 10, 8, i % 3 === 0 ? 1 : 0, 0, 1.5]);
  det.push([i, 'JOB_' + ('00' + i).slice(-3), i + 1, 'H', act ? 'Activo' : 'N/A', 'Si', 1.5, 'E', 'App', 1, '', 0]);
}
var PRINCIPAL = { hay_datos: true, jobs: { cols: COLS, filas: filas }, decomisos: { cols: [], filas: [] },
  historico: { cols: ['Fecha', 'Origen'], filas: [] }, campos: [], parametros: {},
  carga: { fecha: '2026-10-20', numero: 1 }, hoy: '2026-10-23' };
var DETALLE = { detalle: { cols: ['JobId', 'JobName', 'FilaExcel', 'Herramienta', 'EstatusControlM', 'EsCandidato',
  'PromedioDiario', 'EsquemaConsiderado', 'Aplicacion', 'AplicacionEnCatalogo', 'Advertencias', 'PersonasFueraDeDatos'], filas: det } };

var STUB = '<script>\n' +
  'window.__peticiones = []; window.__bajadas = [];\n' +
  'var __falla = /[?&]falla=1/.test(location.search);\n' +
  'window.fetch = function (u) { u = String(u); __peticiones.push(u);\n' +
  '  var detalle = u.indexOf("detalle=1") >= 0;\n' +
  '  var j = detalle ? (__falla ? { error: "detalle caido" } : ' + JSON.stringify(DETALLE) + ') : ' + JSON.stringify(PRINCIPAL) + ';\n' +
  '  var ok = !(detalle && __falla);\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: ok, status: ok ? 200 : 500,\n' +
  '    json: function () { return Promise.resolve(JSON.parse(JSON.stringify(j))); } }); }, 30); }); };\n' +
  // Las bajadas se apuntan en lugar de hacerse: el headless no tiene que desplazar nada.
  'Element.prototype.scrollIntoView = function () { __bajadas.push(this.id || this.tagName); };\n' +
  '</script>\n';

// ---- la sonda (corre en la pagina) ----
function sonda() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 3000; t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  var K = '#orq-kpis';
  function boton(k) { return document.querySelector(K + ' [data-indicador="' + k + '"]'); }
  function val(k) { return boton(k).parentNode.querySelector('.val').textContent; }
  function marcadas() {
    return Array.prototype.filter.call(document.querySelectorAll(K + ' [data-indicador]'), function (b) {
      return b.getAttribute('aria-pressed') === 'true'; }).map(function (b) { return b.getAttribute('data-indicador'); });
  }
  function conSel() { return Array.prototype.map.call(document.querySelectorAll(K + ' .kpi-sel [data-indicador]'), function (b) { return b.getAttribute('data-indicador'); }); }
  function foco() { var a = document.activeElement; return a && a.getAttribute ? a.getAttribute('data-indicador') : null; }
  function abierta() { return !document.getElementById('orq-lista').hidden; }
  function conteo() { return document.getElementById('orq-conteo').textContent; }
  function sel() { return document.getElementById('orq-ind'); }
  function bajadas() { var b = window.__bajadas.slice(); window.__bajadas.length = 0; return b; }
  var falla = /[?&]falla=1/.test(location.search);
  (async function () {
    try {
      await hasta(function () { return boton('huerfanos'); });
      if (falla) {
        boton('huerfanos').click();
        await hasta(function () { return !document.getElementById('orq-error').hidden && !document.getElementById('orq-ver-jobs').disabled; });
        apunta('F1', [abierta(), marcadas(), conSel(), !document.getElementById('orq-error').hidden]);
        apunta('F2', [bajadas(), foco(), document.getElementById('orq-ver-jobs').textContent]);
        apunta('F3', [sel().value, window.__peticiones.filter(function (u) { return /detalle=1/.test(u); }).length]);
      } else {
        apunta('O1', [Array.prototype.map.call(document.querySelectorAll(K + ' [data-indicador]'), function (b) {
          return b.getAttribute('data-indicador') + ':' + b.getAttribute('aria-pressed'); }), document.querySelectorAll(K + ' .kpi').length]);
        boton('huerfanos').click(); await hasta(abierta); await espera(20);
        apunta('O2', [sel().value, marcadas(), conSel(), foco(), conteo(), val('huerfanos')]);
        apunta('O15a', [bajadas(), foco()]);
        boton('activos').click(); await espera(60);
        apunta('O3', [sel().value, marcadas(), conteo(), val('activos')]);
        apunta('O15b', [bajadas(), foco()]);
        boton('activos').click(); await espera(60);
        apunta('O4', [sel().value, marcadas(), conteo(), val('universo')]);
        sel().value = 'orquestados'; sel().dispatchEvent(new Event('change')); await espera(40);
        apunta('O5', [marcadas(), conteo(), val('orquestados')]);
        sel().value = 'candidatos'; sel().dispatchEvent(new Event('change')); await espera(40);
        apunta('O6', marcadas());
        boton('identificados').click(); await espera(60);
        apunta('O7', [sel().value, conteo(), val('identificados')]);
        var b = document.getElementById('orq-buscar'); b.value = 'JOB_01'; b.dispatchEvent(new Event('input')); await espera(40);
        apunta('O8', [sel().value, conteo(), marcadas()]);
        b.value = ''; b.dispatchEvent(new Event('input'));
        var d = document.getElementById('orq-dir'); d.value = 'Dir A'; d.dispatchEvent(new Event('change')); await espera(40);
        apunta('O9', [sel().value, marcadas(), val('identificados'), conteo()]);
        boton('universo').click(); await espera(60);
        apunta('O10', [sel().value, marcadas(), conteo(), val('universo'), foco()]);
        bajadas();
        // O14: ocultar con una tarjeta elegida.
        boton('huerfanos').click(); await espera(60);
        apunta('O14a', [abierta(), marcadas()]);
        bajadas();
        document.getElementById('orq-ver-jobs').click(); await espera(30);
        apunta('O14b', [abierta(), marcadas(), conSel(), sel().value, bajadas()]);
        document.getElementById('orq-ver-jobs').click(); await hasta(abierta); await espera(20);
        apunta('O14c', [abierta(), marcadas(), sel().value, bajadas()]);
        // O11/O12: con la lista cerrada el clic la abre con esa tarjeta.
        document.getElementById('orq-ver-jobs').click(); await espera(30);
        boton('activos').click(); await hasta(abierta); await espera(20);
        apunta('O11', [abierta(), sel().value, marcadas(), conteo(), val('activos'), bajadas(), foco()]);
        document.getElementById('orq-ver-jobs').click(); await espera(30);
        boton('activos').click(); await hasta(abierta); await espera(20);
        apunta('O12', [abierta(), sel().value, marcadas()]);
        apunta('O13', window.__peticiones.filter(function (u) { return /detalle=1/.test(u); }).length);
        function pulsadosTodos() {
          return Array.prototype.map.call(document.querySelectorAll(K + ' [data-indicador]'), function (x) {
            return x.getAttribute('data-indicador') + ':' + x.getAttribute('aria-pressed'); });
        }
        var dir = document.getElementById('orq-dir');
        // L1: tarjeta elegida + Direccion; Limpiar.
        boton('huerfanos').click(); await espera(60);
        dir.value = 'Dir B'; dir.dispatchEvent(new Event('change')); await espera(40);
        apunta('L1a', [sel().value, marcadas(), conteo(), val('huerfanos')]);
        bajadas();
        document.getElementById('orq-limpiar').click(); await espera(40);
        apunta('L1', [sel().value, marcadas(), conSel(), pulsadosTodos(), conteo(), val('universo'), dir.value, abierta(), bajadas()]);
        // L2: tarjeta elegida, luego el desplegable cambiado a mano; Limpiar.
        boton('huerfanos').click(); await espera(60);
        sel().value = 'activos'; sel().dispatchEvent(new Event('change')); await espera(40);
        apunta('L2a', [sel().value, marcadas()]);
        document.getElementById('orq-limpiar').click(); await espera(40);
        apunta('L2', [sel().value, marcadas(), conSel(), conteo()]);
        // L3: con busqueda en la lista; Limpiar la conserva.
        boton('identificados').click(); await espera(60);
        var bus = document.getElementById('orq-buscar'); bus.value = 'JOB_01'; bus.dispatchEvent(new Event('input')); await espera(40);
        apunta('L3a', [sel().value, conteo()]);
        document.getElementById('orq-limpiar').click(); await espera(40);
        apunta('L3', [sel().value, marcadas(), bus.value, conteo()]);
        bus.value = ''; bus.dispatchEvent(new Event('input')); await espera(40);
        // L4: pasar de una tarjeta a otra y luego Limpiar.
        boton('huerfanos').click(); await espera(60);
        boton('activos').click(); await espera(60);
        boton('orquestados').click(); await espera(60);
        apunta('L4a', [sel().value, marcadas()]);
        document.getElementById('orq-limpiar').click(); await espera(40);
        apunta('L4', [sel().value, marcadas(), conSel(), conteo()]);
        // L5: Limpiar sin tarjeta elegida, con un filtro de arriba: lo de siempre.
        dir.value = 'Dir A'; dir.dispatchEvent(new Event('change')); await espera(40);
        document.getElementById('orq-limpiar').click(); await espera(40);
        apunta('L5', [sel().value, marcadas(), conteo(), dir.value, val('universo')]);
        // L6: despues de Limpiar el clic sigue funcionando.
        boton('huerfanos').click(); await espera(60);
        apunta('L6', [sel().value, marcadas(), conteo(), foco()]);
      }
    } catch (e) { errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R });
    document.body.appendChild(pre);
  })();
}

var BANCO = Banco.pagina('orquestacion/orquestacion.html', 'orquestacion.js', STUB, sonda);

Banco.correr({ '/orquestacion/__banco.html': BANCO },
             ['/orquestacion/__banco.html', '/orquestacion/__banco.html?falla=1']).then(function (res) {
  var bien = res[0], mal = res[1];
  if (!bien || !mal) { console.log('FAIL  Chrome no devolvio el resultado de la sonda'); process.exit(1); }
  Check('S0 sin errores de JS en la pagina', [[], []], [bien.errores, mal.errores]);
  var o = Banco.mapa(bien), f = Banco.mapa(mal), NADA = [];
  var T = 'Huérfanos';
  Check('O1 cinco tarjetas filtran (Universo sin aria-pressed); Registro completo no', [
    ['universo:null', 'identificados:false', 'huerfanos:false', 'activos:false', 'orquestados:false'], 6], o.O1);
  Check('O2 clic ' + T + ': desplegable, marca, foco; conteo de la lista = cifra',
    ['huerfanos', ['huerfanos'], ['huerfanos'], 'huerfanos', '8 jobs', '8'], o.O2);
  Check('O3 otra tarjeta reemplaza', ['activos', ['activos'], '20 jobs', '20'], o.O3);
  Check('O4 la misma otra vez la quita: Todos', ['', NADA, '40 jobs', '40'], o.O4);
  Check('O5 el desplegable mueve la marca', [['orquestados'], '10 jobs', '10'], o.O5);
  Check('O6 opcion sin tarjeta: ninguna marcada', NADA, o.O6);
  Check('O7 la tarjeta reemplaza la opcion del desplegable', ['identificados', '32 jobs', '32'], o.O7);
  Check('O8 busqueda y tarjeta conviven', ['identificados', '8 jobs', ['identificados']], o.O8);
  Check('O9 filtro Direccion: marca sigue; cifra = lista', ['identificados', ['identificados'], '16', '16 jobs'], o.O9);
  Check('O10 Universo: Todos, sin marca, foco en Universo', ['', NADA, '20 jobs', '20', 'universo'], o.O10);
  Check('O11 lista cerrada + clic: la abre con esa tarjeta, baja, foco en ella',
    [true, 'activos', ['activos'], '10 jobs', '10', ['orq-jobs'], 'activos'], o.O11);
  Check('O12 lista cerrada con esa tarjeta en el desplegable + clic: abre, no la quita',
    [true, 'activos', ['activos']], o.O12);
  Check('O13 ?detalle=1 se pide una sola vez', 1, o.O13);
  Check('O14a con la lista abierta, Huerfanos marcada', [true, ['huerfanos']], o.O14a);
  Check('O14b ocultar la lista: sin marca ni aria-pressed al momento; desplegable intacto; no baja',
    [false, NADA, NADA, 'huerfanos', NADA], o.O14b);
  Check('O14c volver a abrirla con el boton: la marca vuelve; no baja', [true, ['huerfanos'], 'huerfanos', NADA], o.O14c);
  Check('O15a clic con la lista cerrada: baja a #orq-jobs una vez, foco en la tarjeta', [['orq-jobs'], 'huerfanos'], o.O15a);
  Check('O15b clic con la lista abierta: baja otra vez, foco en la tarjeta', [['orq-jobs'], 'activos'], o.O15b);
  Check('F1 detalle caido: lista oculta, sin marca, aviso de error', [false, NADA, NADA, true], f.F1);
  Check('F2 detalle caido: no baja, foco en la tarjeta, boton vuelve a "Ver la lista"', [NADA, 'huerfanos', 'Ver la lista'], f.F2);
  Check('F3 detalle caido: el desplegable conserva la tarjeta para el reintento', ['huerfanos', 1], f.F3);
  var SIN = ['universo:null', 'identificados:false', 'huerfanos:false', 'activos:false', 'orquestados:false'];
  Check('L1a antes: Huerfanos elegida con Dir B', ['huerfanos', ['huerfanos'], '4 jobs', '4'], o.L1a);
  Check('L1 Limpiar: Mostrar = Todos, sin marca, aria-pressed="false", todos los jobs, Direccion vacia, lista abierta, no baja',
    ['', NADA, NADA, SIN, '40 jobs', '40', '', true, NADA], o.L1);
  Check('L2a antes: el desplegable cambiado a mano mueve la marca', ['activos', ['activos']], o.L2a);
  Check('L2 Limpiar tras cambiar el desplegable a mano: Todos y sin marca', ['', NADA, NADA, '40 jobs'], o.L2);
  Check('L3a antes: Identificados + busqueda', ['identificados', '8 jobs'], o.L3a);
  Check('L3 Limpiar conserva la busqueda de la lista (como siempre) y quita la tarjeta', ['', NADA, 'JOB_01', '10 jobs'], o.L3);
  Check('L4a antes: tres tarjetas seguidas, queda la ultima', ['orquestados', ['orquestados']], o.L4a);
  Check('L4 Limpiar tras cambiar de tarjeta: Todos, sin marca, todos los jobs', ['', NADA, NADA, '40 jobs'], o.L4);
  Check('L5 Limpiar sin tarjeta: Direccion vacia, todos los jobs, como siempre', ['', NADA, '40 jobs', '', '40'], o.L5);
  Check('L6 despues de Limpiar el clic vuelve a filtrar', ['huerfanos', ['huerfanos'], '8 jobs', 'huerfanos'], o.L6);
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
