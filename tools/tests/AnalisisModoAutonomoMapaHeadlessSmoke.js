// tools/tests/AnalisisModoAutonomoMapaHeadlessSmoke.js - la hoja "Mapa por estado"
// de Modo Autonomo (analisis/analisis.js + modo_autonomo.js + mapa_mexico.js) en
// un Chrome de verdad, con el banco de siempre (BancoHeadless.js) y un fetch de
// mentira. No escribe nada en disco.
//
//   G1      la hoja: el SVG con los 32 estados y su copia en el recuadro;
//   T1      pasar el raton por un estado da sus cifras en el tip;
//   C1-C3   el selector de capa (con el de causa solo en "una causa") y el de
//           causa cambian lo pintado, y el foco se queda en el selector;
//   D1-D3   clic en un estado del dibujo muestra sus tiendas; otro clic las
//           quita; el nombre en la tabla hace lo mismo y conserva el foco;
//   X1      el Excel se arma con el mapa;
//   F1-F2   (?sinmapa=1) si mapa_mexico.js no carga: la hoja lo dice, la tabla
//           sigue abriendo estados y el zoom de causas sigue igual;
//   R1      sin errores de JavaScript.
//
//   node tools\tests\AnalisisModoAutonomoMapaHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
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

function ev(mes, tienda, origen, n2, horas) {
  return [mes, mes + '-10 10:00', String(horas), String(tienda), 'Sucursal ' + tienda, 'Modo Autónomo', 'Puntual', origen, '', '0', 'completo', n2, 'x', 'causa', '0'];
}
function srv(t, clave) { return ['SRV' + t, String(t), 'Sucursal ' + t, 'x', '2026-01-01', '2026-01-01', '1', clave]; }
var MA = {
  servicio: 'modo_autonomo', desde: '2026-03-01', hasta: '2026-05-31',
  bloques: {
    parametros: { columnas: ['Clave', 'Valor'], filas: [['UltimaCargaExcel', '2026-11-20 07:51'], ['CargaTickets', '2026-11-20 07:51']] },
    eventos: { columnas: ['Mes', 'Inicio', 'Horas', 'Tienda', 'TiendaNombre', 'Aplicacion', 'Tipo', 'Origen', 'OrigenDetalle', 'RespaldoFallo',
                          'Alcance', 'Nivel2', 'Nivel3', 'CausaIM', 'TicketsMA'], filas: [
      ev('2026-03', 101, 'electrica', 'El UPS no sostuvo', 2), ev('2026-04', 101, 'electrica', 'El UPS no sostuvo', 1),
      ev('2026-04', 102, 'comunicaciones', 'Red local de la tienda', 1), ev('2026-05', 104, 'electrica', 'Planta de emergencia', 0.5)] },
    incidentes: { columnas: ['Mes', 'Fecha', 'Tienda', 'Tickets', 'Motivo', 'Fuente', 'Nivel2', 'Nivel3', 'SinContacto', 'Alcance', 'TiendaConEventoIM'], filas: [] }
  },
  servidor: { disponible: true, bloques: {
    parametros: { columnas: ['Clave', 'Valor'], filas: [['UltimaLecturaPortal', '2026-06-01 08:00'], ['Servidores', '4']] },
    fallas: { columnas: ['Mes', 'Inicio', 'Minutos', 'Tienda', 'TiendaNombre', 'Estado', 'Tipo', 'Causa', 'Horario', 'Cuenta', 'Reporte', 'CausaMA'], filas: [
      ['2026-04', '2026-04-10 11:00', '60', '103', 'Sucursal 103', 'x', 'apagado', 'Falla eléctrica', '1', '1', 'sin', null]] },
    modoautonomo: { columnas: ['Fuente', 'Mes', 'Fecha', 'Tienda', 'Causa', 'Nivel2', 'Paso', 'PasoCausa', 'PasoInicio'], filas: [] },
    servidores: { columnas: ['Servidor', 'Tienda', 'TiendaNombre', 'Estado', 'LogDesde', 'RedDesde', 'Alcanzado', 'EstadoClave'],
                  filas: [srv(101, 'NLE'), srv(102, 'NLE'), srv(103, 'NLE'), srv(104, 'COA')] },
    causas: { columnas: ['Tipo', 'Causa', 'Total', 'EnHorario', 'Servidores', 'SinReporte'], filas: [] }
  } }
};
var SERVICIOS = { servicios: [
  { Servicio: 'modo_autonomo', Nombre: 'Modo Autónomo', Descripcion: 'x', DesdeSugerido: '2026-01-01', ReglasVersion: '1', Reglas: '0', Criterios: '0' }] };

// ?sinmapa=1: el <script> de mapa_mexico.js falla como un 404 (sin pedirlo).
var STUB = '<script>\n' +
  'window.__blobs = [];\n' +
  'if (/sinmapa=1/.test(location.search)) { var __ap = Node.prototype.appendChild; Node.prototype.appendChild = function (n) {\n' +
  '  if (n && n.tagName === "SCRIPT" && /mapa_mexico\\.js/.test(n.src)) { setTimeout(function () { n.onerror && n.onerror(new Event("error")); }, 10); return n; }\n' +
  '  return __ap.call(this, n); }; }\n' +
  'window.fetch = function (u) { u = String(u);\n' +
  '  var j = u.indexOf("accion=servicios") >= 0 ? ' + JSON.stringify(SERVICIOS) + ' : ' + JSON.stringify(MA) + ';\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 200,\n' +
  '    json: function () { return Promise.resolve(JSON.parse(JSON.stringify(j))); },\n' +
  '    arrayBuffer: function () { return Promise.resolve(new TextEncoder().encode(JSON.stringify(j)).buffer); } }); }, 30); }); };\n' +
  'URL.createObjectURL = function (b) { __blobs.push(b.size); return "blob:prueba"; };\n' +
  'URL.revokeObjectURL = function () {};\n' +
  'HTMLAnchorElement.prototype.click = function () {};\n' +
  '</script>\n';

function sonda() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function $(id) { return document.getElementById('an-' + id); }
  function espera(cond, ms) {
    return new Promise(function (ok) {
      var t0 = Date.now();
      (function mira() { if (cond() || Date.now() - t0 > (ms || 4000)) return ok(cond()); setTimeout(mira, 20); })();
    });
  }
  function clic(el) { if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }
  function q(sel) { return $('panel').querySelector(sel); }
  function n(sel) { return $('panel').querySelectorAll(sel).length; }
  function escoger(campo, v) { var s = q('select[data-ma-mapa="' + campo + '"]'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }
  function fin() {
    R.push(['R1', errores]);
    var pre = document.createElement('pre'); pre.id = '__res'; pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  }
  var sinMapa = /sinmapa=1/.test(location.search);
  espera(function () { return /Eventos de los IMs/.test($('kpis').textContent); }).then(function () {
    clic($('pestanas').querySelector('[data-hoja="Mapa"]'));
    return espera(function () { return /% de las tiendas de cada estado/.test($('panel').textContent); });
  }).then(function () {
    if (sinMapa) {
      R.push(['F1', [n('svg.an-mapa-svg'), /No se pudo cargar el dibujo del mapa/.test($('panel').textContent), n('button[data-ma-estado]')]]);
      clic(q('button[data-ma-estado="NLE"]'));
      return espera(function () { return /Tiendas de Nuevo León/.test($('panel').textContent); }).then(function (abrio) {
        clic($('pestanas').querySelector('[data-hoja="Causas"]'));
        return espera(function () { return n('[data-ma-zoom]') > 0; }).then(function () {
          clic(q('[data-ma-zoom="electrica"]'));
          return espera(function () { return /Falla eléctrica: nivel 2/.test($('panel').textContent); });
        }).then(function (zoom) { R.push(['F2', [abrio, zoom]]); });
      });
    }
    R.push(['G1', [n('svg.an-mapa-svg'), n('svg.an-mapa-svg path.an-edo'), n('path[data-ma-estado]'), !!q('clipPath#an-mapa-recorte')]]);
    var p = q('path[data-ma-estado="NLE"]'), r = p.getBoundingClientRect();
    p.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    R.push(['T1', [$('tip').hidden, $('tip').textContent]]);

    escoger('capa', 'causa');
    var c1 = [!!q('select[data-ma-mapa="causa"]'), q('select[data-ma-mapa="causa"]').value, document.activeElement === q('select[data-ma-mapa="capa"]'),
              /Tiendas con eventos por falla eléctrica/.test($('panel').textContent)];
    R.push(['C1', c1]);
    escoger('causa', 'comunicaciones');
    R.push(['C2', [q('select[data-ma-mapa="causa"]').value, document.activeElement === q('select[data-ma-mapa="causa"]'),
                   q('path[data-ma-estado="NLE"]').getAttribute('data-tip').split('\n')[1], q('path[data-ma-estado="COA"]').getAttribute('class')]]);
    escoger('capa', 'servidor');
    R.push(['C3', [!!q('select[data-ma-mapa="causa"]'), /1 fallas sin reporte/.test(q('path[data-ma-estado="NLE"]').getAttribute('data-tip'))]]);

    clic(q('path[data-ma-estado="NLE"]'));
    var d1 = [/Tiendas de Nuevo León/.test($('panel').textContent), n('path.sel'), $('tip').hidden, q('select[data-ma-mapa="capa"]').value];
    R.push(['D1', d1]);
    clic(q('path[data-ma-estado="NLE"]'));
    R.push(['D2', [/Tiendas de /.test($('panel').textContent), n('path.sel')]]);
    var b = q('button[data-ma-estado="COA"]'); b.focus(); clic(b);
    var foco = document.activeElement;
    R.push(['D3', [/Tiendas de Coahuila/.test($('panel').textContent), foco && foco.getAttribute('data-ma-estado'), foco && foco.getAttribute('aria-pressed')]]);

    clic($('excel'));
    return espera(function () { return __blobs.length > 0; }, 8000).then(function () { R.push(['X1', [__blobs.length, __blobs[0] > 4000]]); });
  }).then(fin, function (e) { errores.push('sonda: ' + e.message); fin(); });
}

var pagina = Banco.pagina('analisis/analisis.html', 'analisis.js', STUB, sonda);
var BASE = '/analisis/__mapa.html?servicio=modo_autonomo&desde=2026-03-01&hasta=2026-05-31';
Banco.correr({ '/analisis/__mapa.html': pagina }, [BASE, BASE + '&sinmapa=1'], 20000).then(function (res) {
  var r = Banco.mapa(res[0]), f = Banco.mapa(res[1]);
  if (!res[0] || !res[1]) { console.log('FAIL  la pagina no dejo resultado'); process.exit(1); }
  Check('G1 un SVG, 64 paths (32 y el recuadro), los 2 estados con tiendas abren (x2), recorte', [1, 64, 4, true], r.G1);
  Check('T1 el tip de Nuevo Leon', [false, 'Nuevo León\n2 de 3 tiendas (67%) con eventos de los IMs\n3 eventos · 4 horas'], r.T1);
  Check('C1 "una causa": sale su selector con la mas comun, el foco en el de capa', [true, 'electrica', true, true], r.C1);
  Check('C2 otra causa: lo pintado cambia, el foco en el de causa', ['comunicaciones', true, '1 de 3 tiendas (33%) con eventos por comunicaciones', 'an-edo c0'], r.C2);
  Check('C3 servidor: sin selector de causa, con sus fallas', [false, true], r.C3);
  Check('D1 clic en el estado: sus tiendas, marcado, sin tip, la capa se queda', [true, 2, true, 'servidor'], r.D1);
  Check('D2 otro clic: se quitan', [false, 0], r.D2);
  Check('D3 el nombre en la tabla: sus tiendas y el foco en el mismo boton', [true, 'COA', 'true'], r.D3);
  Check('X1 el Excel', [1, true], r.X1);
  Check('F1 sin mapa_mexico.js: sin SVG, lo dice, la tabla con sus estados', [0, true, 2], f.F1);
  Check('F2 sin mapa_mexico.js: la tabla abre el estado y el zoom de causas sigue', [true, true], f.F2);
  Check('R1 sin errores de JavaScript', [[], []], [r.R1, f.R1]);
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
});
