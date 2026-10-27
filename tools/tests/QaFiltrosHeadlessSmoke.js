// tools/tests/QaFiltrosHeadlessSmoke.js - los filtros de la pestaña QA (los
// de QARE), su descarga y las dos graficas de Top 10, en un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco).
//
// El qa.ashx de mentira contesta segun lo pedido: la peticion por omision
// (sin parametros) trae los Top 10 "BASE"; cualquier otra trae otros grupos
// y tecnicos ("FILTRADO ...") y otro total. Si una grafica se repintara con
// una vista filtrada, sus etiquetas dejarian de ser las de BASE.
//
//   F0       el panel tiene los mismos rotulos que el de QARE, abre con los
//            15 dias que terminan ayer, sin filtros, sin boton de descarga,
//            y la primera peticion es la de siempre (sin parametros);
//   F1-F6    cada filtro solo: fecha inicio, rango 30, rango 15 (vuelve a la
//            peticion sin parametros), C1, Grupos, Lideres; los KPIs siguen
//            al filtro;
//   C1-C2    los tres a la vez, y el detalle abierto los lleva ademas de
//            Validacion = Incorrecto;
//   D1-D3    descarga: el boton sale con un filtro, pide detail&pageSize=0
//            con el rango y los filtros (sin validacion), y el .xlsx trae la
//            hoja, la cabecera y los tickets esperados;
//   L1-L2    Limpiar quita solo C1 / Grupos / Lideres, las fechas se quedan,
//            vuelve la peticion sin parametros y se va el boton;
//   G*       tras CADA paso, y en tres vueltas de filtros al azar, las dos
//            graficas siguen con sus etiquetas, valores y rotulos de BASE;
//   E1       una vista filtrada que falla no toca las graficas;
//   P1       ?lento=1: un filtro puesto antes de que llegue la primera carga
//            pide la de por omision UNA vez y las graficas salen de ella.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\QaFiltrosHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
//
// Sin Chrome instalado dice SKIP y sale 0. Otra ruta: CHROME=<ruta>.
'use strict';
var fs = require('fs');
var path = require('path');
var Banco = require('./BancoHeadless');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

// --- rotulos del panel de QARE, leidos de su marcado -------------------------
var raiz = path.join(__dirname, '..', '..');
function rotulos(rel, prefijo) {
  var html = fs.readFileSync(path.join(raiz, rel), 'utf8');
  var sec = new RegExp('<section class="filtros" id="' + prefijo + 'filtros">([\\s\\S]*?)</section>').exec(html);
  if (!sec) return null;
  var r = [];
  sec[1].replace(/<label[^>]*>([^<]*)<\/label>/g, function (_, t) { r.push(t.trim()); });
  sec[1].replace(/data-dias="(\d+)"/g, function (_, d) { r.push('dias:' + d); });
  sec[1].replace(/<select id="[a-z]+-([a-z0-9-]+)" multiple>/g, function (_, d) { r.push('multi:' + d); });
  sec[1].replace(/<button class="btn gris" id="[a-z]+-btn-limpiar"[^>]*>([^<]*)</g, function (_, t) { r.push('limpiar:' + t); });
  return r;
}
Check('F0a el panel de QA tiene los rotulos, rangos, multiselect y Limpiar de QARE',
  rotulos('qare/qare.html', 'qare-'), rotulos('qa/qa.html', 'qa-'));

if (!Banco.CHROME) { console.log('SKIP  sin Chrome/Edge (CHROME=<ruta> para indicar otro)'); process.exit(fallos ? 1 : 0); }

var ANTES = '<script>\n' +
  'window.__pet = []; window.__blobs = []; window.__alertas = [];\n' +
  'window.alert = function (m) { __alertas.push(String(m)); };\n' +
  'URL.createObjectURL = function (b) { __blobs.push(b); return "blob:prueba"; };\n' +
  'URL.revokeObjectURL = function () {};\n' +
  'Element.prototype.scrollIntoView = function () {};\n' +
  'var LENTO = /lento=1/.test(location.search);\n' +
  'function resp(j, estado, ms) { return new Promise(function (r) { setTimeout(function () { r({ ok: !estado, status: estado || 200,\n' +
  '  json: function () { return Promise.resolve(j); },\n' +
  '  text: function () { return Promise.resolve(JSON.stringify(j)); } }); }, ms || 15); }); }\n' +
  'window.fetch = function (u) { u = new URL(String(u), location.href);\n' +
  '  if (/backlog_catalogos/.test(u.pathname)) return resp({ c1: ["S-A", "S-B", "S-FALLA"], grupos: ["G1", "G2", "G3"], lideres: ["L1", "Sin Torre"] });\n' +
  '  var q = u.searchParams, a = q.get("action"); var p = {}; q.forEach(function (v, k) { p[k] = v; });\n' +
  '  __pet.push(p);\n' +
  '  var org = ["fecha_inicio", "fecha_fin", "c1", "grupos", "lideres"].some(function (k) { return q.has(k); });\n' +
  '  if (q.get("c1") === "S-FALLA") return resp({ error: true, message: "falla de prueba" }, 500);\n' +
  '  if (a === "summary") {\n' +
  '    var n = (q.get("c1") || "").length + (q.get("grupos") || "").length * 3 + (q.get("lideres") || "").length * 7;\n' +
  '    var j = org ? { summary: { totalTickets: 1000 + n, incorrectos: n, incorrectosPct: 1 }, source: { fechaInicio: q.get("fecha_inicio"), fechaFin: q.get("fecha_fin") }, dataInfo: {},\n' +
  '        porGrupo: [{ grupo: "FILTRADO G", tickets: 99 }], porTecnico: [{ tecnico: "FILTRADO T", tickets: 98 }],\n' +
  '        recategorizacion: [{ grupo: "RX", grupoCorrecto: "RY", tickets: n }], validacion: null }\n' +
  '      : { summary: { totalTickets: 100, incorrectos: 12, incorrectosPct: 12 }, source: {}, dataInfo: {},\n' +
  '        porGrupo: [{ grupo: "BASE G1", tickets: 8 }, { grupo: "BASE G2", tickets: 4 }],\n' +
  '        porTecnico: [{ tecnico: "BASE T1", tickets: 5 }, { tecnico: "BASE T2", tickets: 3 }, { tecnico: "BASE T3", tickets: 1 }],\n' +
  '        recategorizacion: [{ grupo: "R1", grupoCorrecto: "R2", tickets: 3 }], validacion: null };\n' +
  '    return resp(j, 0, !org && LENTO ? 700 : 15);\n' +
  '  }\n' +
  '  if (a === "qare") return resp({ validacion: [{ validacion: "Incorrecto", tickets: org ? 1 : 12 }, { validacion: "OK", tickets: org ? 2 : 88 }] });\n' +
  '  if (a === "detail") {\n' +
  '    var rows = [\n' +
  '      { "Código": "INC-1", "Fecha de registro": "2026-10-20T08:15:00", Grupo: "G1", C1: "S-A", Lider: "L1", Estado: "Cerrado", Validacion: "Incorrecto", Caducada: true, "Intentos de solución": 2, "Título": "Uno" },\n' +
  '      { "Código": "INC-2", "Fecha de registro": "2026-10-21T09:00:00", Grupo: "G1", C1: "S-B", Lider: "L1", Estado: "Abierto", Validacion: "OK", Caducada: false, "Intentos de solución": null, "Título": "Dos" }];\n' +
  '    return resp({ rows: rows, total: rows.length, page: 1, meta: { source: { fechaInicio: q.get("fecha_inicio"), fechaFin: q.get("fecha_fin") } } });\n' +
  '  }\n' +
  '  return resp({ error: true, message: "accion" }, 400); };\n' +
  '</script>\n';

function sonda() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  var lento = /lento=1/.test(location.search);
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 4000; t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  function $(id) { return document.getElementById('qa-' + id); }
  function graficas() {
    var g = Chart.getChart('qa-chart-grupo'), t = Chart.getChart('qa-chart-tecnico');
    return [g.data.labels.slice(), g.data.datasets[0].data.slice(), t.data.labels.slice(), t.data.datasets[0].data.slice(),
      $('hint-grupo').textContent, $('hint-tecnico').textContent];
  }
  function ultima(accion) {
    for (var i = __pet.length - 1; i >= 0; i--) if (__pet[i].action === accion) return __pet[i];
    return null;
  }
  function sinAccion(p) { if (!p) return p; var c = {}; Object.keys(p).sort().forEach(function (k) { if (k !== 'action') c[k] = p[k]; }); return c; }
  function cuantas(accion) { return __pet.filter(function (p) { return p.action === accion; }).length; }
  async function tras(accion, fn) {
    var n = cuantas(accion); fn();
    await hasta(function () { return cuantas(accion) > n; }); await espera(120);
  }
  function kpi() { var v = document.querySelector('#qa-kpis .kpi-val'); return v && v.textContent; }
  function elegir(id, valores) {
    var sel = $(id);
    Array.prototype.forEach.call(sel.options, function (o) { o.selected = valores.indexOf(o.value) >= 0; });
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function fecha(id, v) { $(id).value = v; $(id).dispatchEvent(new Event('change', { bubbles: true })); }
  function descargaVisible() { return $('btn-descargar').style.display !== 'none'; }
  // Dia de Mexico (UTC-6 fijo) menos `n` dias, sin pasar por qa.js.
  function diaMx(n) { return new Date(Date.now() - 6 * 36e5 - n * 864e5).toISOString().slice(0, 10); }

  (async function () {
    try {
      if (lento) {
        // El filtro sale ANTES que la primera carga (que tarda 700 ms): las
        // graficas tienen que salir de esa carga, pedida una sola vez.
        await hasta(function () { return $('f-c1').options.length > 0; });
        elegir('f-c1', ['S-A']);
        await hasta(function () { return Chart.getChart('qa-chart-grupo').data.labels.length; });
        await espera(300);
        apunta('BASE', graficas());
        apunta('P1', [__pet.filter(function (p) { return p.action === 'summary' && Object.keys(p).length === 1; }).length,
          __pet.some(function (p) { return p.action === 'summary' && p.c1 === 'S-A'; }), kpi()]);
        throw null;
      }
      await hasta(function () { return Chart.getChart('qa-chart-grupo') && Chart.getChart('qa-chart-grupo').data.labels.length; });
      await hasta(function () { return $('f-c1').options.length > 0; });
      await espera(100);
      var BASE = graficas();
      apunta('BASE', BASE);
      function g(caso) { apunta('G ' + caso, graficas()); }

      apunta('F0', [$('f-inicio').value, $('f-fin').value, descargaVisible(),
        Array.prototype.map.call($('f-c1').options, function (o) { return o.value; }),
        sinAccion(__pet[0]), __pet[0].action]);

      // F1 fecha inicio: rango explicito, sin filtros org.
      await tras('summary', function () { fecha('f-inicio', diaMx(7)); });
      apunta('F1', [sinAccion(ultima('summary')), sinAccion(ultima('qare')), kpi() !== '100']); g('F1');
      // F2 rango 30.
      await tras('summary', function () { document.querySelector('#qa-filtros [data-dias="30"]').click(); });
      apunta('F2', [sinAccion(ultima('summary')), $('f-inicio').value, $('f-fin').value]); g('F2');
      // F3 rango 15 = vista por omision: la peticion de siempre.
      await tras('summary', function () { document.querySelector('#qa-filtros [data-dias="15"]').click(); });
      apunta('F3', [sinAccion(ultima('summary')), kpi()]); g('F3');
      // F4-F6 cada filtro organizacional solo.
      await tras('summary', function () { elegir('f-c1', ['S-A']); });
      apunta('F4', [sinAccion(ultima('summary')), descargaVisible(), kpi()]); g('F4');
      await tras('summary', function () { elegir('f-c1', []); elegir('f-grupos', ['G2']); });
      apunta('F5', [sinAccion(ultima('summary')), descargaVisible()]); g('F5');
      await tras('summary', function () { elegir('f-grupos', []); elegir('f-lideres', ['Sin Torre']); });
      apunta('F6', [sinAccion(ultima('summary')), descargaVisible()]); g('F6');
      // C1 los tres a la vez (en una sola peticion: auto-aplicado de 250 ms).
      var antes = cuantas('summary');
      await tras('summary', function () { elegir('f-c1', ['S-A', 'S-B']); elegir('f-grupos', ['G1']); elegir('f-lideres', ['L1']); });
      apunta('C1', [sinAccion(ultima('summary')), cuantas('summary') - antes, $('tbody-recat').textContent.indexOf('RX') >= 0]); g('C1');
      // C2 detalle abierto: lleva la vista ademas de Validacion = Incorrecto.
      await tras('detail', function () { $('btn-detalle').click(); });
      apunta('C2', sinAccion(ultima('detail'))); g('C2');

      // D descarga.
      await tras('detail', function () { $('btn-descargar').click(); });
      apunta('D1', sinAccion(ultima('detail')));
      await hasta(function () { return __blobs.length > 0; });
      var buf = new Uint8Array(await __blobs[0].arrayBuffer());
      var libro = XLSX.read(buf, { type: 'array' });
      var hoja = libro.Sheets[libro.SheetNames[0]];
      var aoa = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: true });
      var enc = aoa.findIndex(function (f) { return f[0] === 'Fecha de registro'; });
      var cab = aoa[enc], col = function (k) { return cab.indexOf(k); };
      apunta('D2', [libro.SheetNames, aoa[0][0], aoa[3].slice(0, 2), aoa[4].slice(0, 2), aoa[5].slice(0, 2),
        aoa[6].slice(0, 2), aoa.length - enc - 1,
        cab.slice(0, 7), $('btn-descargar').textContent, $('btn-descargar').disabled]);
      apunta('D3', [aoa[enc + 1][col('Código')], aoa[enc + 1][col('Fecha de registro')], aoa[enc + 1][col('C1')],
        aoa[enc + 1][col('Lider')], aoa[enc + 1][col('Caducada')], aoa[enc + 2][col('Caducada')],
        aoa[enc + 1][col('Intentos de solución')], aoa[enc + 2][col('Intentos de solución')], __alertas]);
      g('D');

      // L Limpiar: solo C1 / Grupos / Lideres; las fechas (15 dias por omision) se quedan.
      var fi = $('f-inicio').value, ff = $('f-fin').value;
      var det = cuantas('detail');
      await tras('summary', function () { $('btn-limpiar').click(); });
      await hasta(function () { return cuantas('detail') > det; }); await espera(80);
      apunta('L1', [sinAccion(ultima('summary')), $('f-inicio').value === fi, $('f-fin').value === ff,
        ['f-c1', 'f-grupos', 'f-lideres'].map(function (id) { return $(id).selectedOptions.length; }), descargaVisible(), kpi()]);
      apunta('L2', sinAccion(ultima('detail'))); g('L');
      // Limpiar con fechas propias: las conserva y las manda.
      await tras('summary', function () { fecha('f-fin', diaMx(3)); });
      await tras('summary', function () { elegir('f-grupos', ['G3']); });
      await tras('summary', function () { $('btn-limpiar').click(); });
      apunta('L3', [sinAccion(ultima('summary')), $('f-fin').value]); g('L3');

      // Vueltas de filtros al azar (semilla fija).
      var semilla = 7;
      function azar(n) { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; }
      for (var v = 0; v < 3; v++) {
        await tras('summary', function () { fecha('f-inicio', diaMx(10 + azar(20))); });
        await tras('summary', function () { elegir('f-c1', [['S-A'], ['S-B'], ['S-A', 'S-B']][azar(3)]); elegir('f-lideres', [['L1'], []][azar(2)]); });
        await tras('summary', function () { $('btn-limpiar').click(); });
        g('V' + v);
      }

      // E1 una vista que falla no toca las graficas.
      await tras('summary', function () { elegir('f-c1', ['S-FALLA']); });
      await espera(100);
      apunta('E1', [$('error-global').hidden, $('error-global-msg').textContent]); g('E1');

      apunta('FIN', [cuantas('summary'), __pet.filter(function (p) { return p.action === 'summary' && Object.keys(p).length === 1; }).length]);
    } catch (e) { if (e) errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R });
    document.body.appendChild(pre);
  })();
}

var BANCO = Banco.pagina('qa/qa.html', 'qa.js', ANTES, sonda);
Banco.correr({ '/qa/__banco.html': BANCO }, ['/qa/__banco.html', '/qa/__banco.html?lento=1']).then(function (res) {
  if (!res[0]) { console.log('FAIL  Chrome no devolvio el resultado de la sonda'); process.exit(1); }
  Check('S0 sin errores de JS en la pagina', [], res[0].errores);
  var o = Banco.mapa(res[0]);
  function dia(n) { return new Date(Date.now() - 6 * 36e5 - n * 864e5).toISOString().slice(0, 10); }
  var BASE = [['BASE G1', 'BASE G2'], [8, 4], ['BASE T1', 'BASE T2', 'BASE T3'], [5, 3, 1], '2 grupos', '3 tecnicos'];
  Check('G0 las graficas salen de la carga por omision', BASE, o.BASE);

  Check('F0 abre con los 15 dias que terminan ayer, sin descarga, listas llenas y la peticion de siempre',
    [dia(15), dia(1), false, ['S-A', 'S-B', 'S-FALLA'], {}, 'summary'], o.F0);
  Check('F1 Fecha inicio: resumen y distribucion con el rango, sin filtros org; los KPIs cambian',
    [{ fecha_fin: dia(1), fecha_inicio: dia(7) }, { fecha_fin: dia(1), fecha_inicio: dia(7) }, true], o.F1);
  Check('F2 Rango 30 dias: 30 dias que terminan ayer', [{ fecha_fin: dia(1), fecha_inicio: dia(30) }, dia(30), dia(1)], o.F2);
  Check('F3 Rango 15 dias = por omision: la peticion de siempre y los KPIs de siempre', [{}, '100'], o.F3);
  Check('F4 Servicio / C1 solo, con el boton de descarga', [{ c1: 'S-A', fecha_fin: dia(1), fecha_inicio: dia(15) }, true, '1,003'], o.F4);
  Check('F5 Grupos solo', [{ fecha_fin: dia(1), fecha_inicio: dia(15), grupos: 'G2' }, true], o.F5);
  Check('F6 Lideres solo', [{ fecha_fin: dia(1), fecha_inicio: dia(15), lideres: 'Sin Torre' }, true], o.F6);
  Check('C1 los tres a la vez, en UNA peticion, y la recategorizacion sigue al filtro',
    [{ c1: 'S-A,S-B', fecha_fin: dia(1), fecha_inicio: dia(15), grupos: 'G1', lideres: 'L1' }, 1, true], o.C1);
  Check('C2 el detalle lleva la vista ademas de Validacion = Incorrecto',
    { c1: 'S-A,S-B', fecha_fin: dia(1), fecha_inicio: dia(15), grupos: 'G1', lideres: 'L1', page: '1', pageSize: '100', validacion: 'Incorrecto' }, o.C2);

  Check('D1 la descarga pide el detalle sin paginar, con el rango y los filtros, todos los estados',
    { c1: 'S-A,S-B', fecha_fin: dia(1), fecha_inicio: dia(15), grupos: 'G1', lideres: 'L1', page: '1', pageSize: '0' }, o.D1);
  Check('D2 hoja, titulo, cabecera, 2 tickets, columnas y el boton vuelve a su estado',
    [['Tickets QA'], 'QA — Tickets', ['Servicio / C1', 'S-A, S-B'], ['Grupos', 'G1'], ['Lideres', 'L1'], ['Total de tickets', '2'], 2,
      ['Fecha de registro', 'Fecha estimada resolución', 'Código', 'Grupo', 'C1', 'Lider', 'Técnico de 2ª línea'], '⬇ Descargar QA', false], o.D2);
  Check('D3 valores: codigo, fecha sin T, C1/Lider, bit 1/0, numero y vacio; sin avisos',
    ['INC-1', '2026-10-20 08:15:00', 'S-A', 'L1', 1, 0, 2, '', []], o.D3);

  Check('L1 Limpiar: peticion de siempre, fechas intactas, nada elegido, sin descarga, KPIs de siempre',
    [{}, true, true, [0, 0, 0], false, '100'], o.L1);
  Check('L2 Limpiar recarga el detalle abierto sin los filtros org', { page: '1', pageSize: '100', validacion: 'Incorrecto' }, o.L2);
  Check('L3 Limpiar con fechas propias: las conserva y las manda', [{ fecha_fin: dia(3), fecha_inicio: dia(15) }, dia(3)], o.L3);
  Check('E1 una vista que falla muestra la banda de error', [false, 'falla de prueba'], o.E1);

  var pasos = Object.keys(o).filter(function (k) { return k.indexOf('G ') === 0; });
  Check('G* las dos graficas no cambian en ningun paso (' + pasos.length + ' pasos)', pasos.map(function () { return BASE; }),
    pasos.map(function (k) { return o[k]; }));
  Check('G+ la carga por omision no se duplica: las sin parametros son solo las de la vista por omision',
    true, !!o.FIN && o.FIN[1] === 3);

  if (!res[1]) { console.log('FAIL  Chrome no devolvio la sonda lenta'); process.exit(1); }
  var l = Banco.mapa(res[1]);
  Check('P0 (lento) sin errores de JS', [], res[1].errores);
  Check('P1 (lento) graficas de la carga por omision', BASE, l.BASE);
  Check('P2 (lento) la carga por omision se pidio UNA vez y los KPIs son los del filtro', [1, true, '1,003'], l.P1);

  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
