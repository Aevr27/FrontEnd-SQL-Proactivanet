// tools/tests/RefrescoModulosHeadlessSmoke.js - refresco en segundo plano de
// QA, Efectividad, Orquestacion y Experiencia, y el router del tablero que
// los refresca, en un Chrome de verdad (tools/tests/BancoHeadless.js; no
// escribe en disco).
//
// Cada pagina suelta lleva un fetch de mentira con version (__v cambia el
// sello y los datos), fallo (__falla) y lentitud (__lento ms), y cuenta las
// peticiones. La sonda llama a window.Tablero<Modulo>Modulo.refrescar(), que
// es lo mismo que llama el temporizador del tablero.
//
//   Q  qa/qa.html: Q1 arranque con "Consultado"; Q2 con un rango propio y el
//      detalle abierto, el refresco no pone "—" ni "Calculando…" mientras
//      pide, trae cifras y Top 10 nuevos, conserva fechas, y el detalle se
//      vuelve a pedir con sus filtros y su pagina; Q3 dos refrescos a la vez
//      = una peticion; Q4 un fallo deja datos y "Consultado" y avisa;
//      Q5 "Actualizar" refresca.
//   E  efectividad/efectividad.html: E1 arranque; E2 con la boleta abierta
//      no se puede refrescar; E3 tipo, busqueda, hoja y motivo desplegado
//      se quedan y llega el dato nuevo; E4 un fallo deja todo y avisa.
//   O  orquestacion/orquestacion.html: O1 arranque; O2 Direccion, indicador
//      del historico y lista abierta se quedan; la lista se vuelve a pedir
//      solo si llego otra carga del Excel; O3 un fallo deja todo y avisa.
//   X  experiencia/experiencia.html (con el mock guardado como respuesta del
//      handler): X1 arranque en vivo con "Consultado"; X2 con un modal
//      abierto no se puede refrescar; X3 Director, fila del Detalle
//      desplegada y "Ver por" se quedan, sello nuevo; X4 un fallo avisa y
//      deja todo.
//   D  dashboard.html#efectividad, RefrescoAuto.INTERVALO_DATOS = 1500 ms:
//      D1 la pestaña a la vista se refresca sola; D2 en otra pestaña no se
//      pide; al volver, una vez, sin volver a montar (un solo <script> y un
//      solo efectividad.html); D3 con la boleta abierta no se refresca.
//
//   node tools\tests\RefrescoModulosHeadlessSmoke.js   # sale 0 si todo paso
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

// Fetch de mentira comun: `responde(url, v)` arma el JSON (o una promesa).
// Cuenta por clave (`clave(url)`), y respeta __falla / __lento.
function stub(responde, clave) {
  return '<script>\n' +
    'Element.prototype.scrollIntoView = function () {};\n' +
    'var SELLO = ' + JSON.stringify(SELLO) + ';\n' +
    'window.__v = 1; window.__falla = false; window.__lento = 0; window.__pedidas = {}; window.__urls = [];\n' +
    'window.__fetchOriginal = window.fetch;\n' +
    'var __responde = ' + responde.toString() + ';\n' +
    'var __clave = ' + clave.toString() + ';\n' +
    'window.fetch = function (u) { u = String(u); var k = __clave(u); window.__urls.push(u);\n' +
    '  if (k === null) return window.__fetchOriginal.apply(window, arguments);\n' +
    '  window.__pedidas[k] = (window.__pedidas[k] || 0) + 1;\n' +
    '  var v = window.__v, falla = window.__falla;\n' +
    '  return new Promise(function (ok) { setTimeout(ok, 20 + window.__lento); })\n' +
    '    .then(function () { return falla ? { error: "caido" } : __responde(u, v); })\n' +
    '    .then(function (j) { var bien = !falla;\n' +
    '      return { ok: bien, status: bien ? 200 : 500,\n' +
    '        json: function () { return Promise.resolve(JSON.parse(JSON.stringify(j))); },\n' +
    '        text: function () { return Promise.resolve(JSON.stringify(j)); } }; }); };\n' +
    '</script>\n';
}

var SELLO = { 1: '2026-10-29T08:00:00', 2: '2026-10-30T09:15:00', 3: '2026-10-30T11:40:00' };

// Comun de las sondas: espera, apunta y cierra con <pre id="__res">.
var COMUN = 'var SELLO = ' + JSON.stringify(SELLO) + ';\n' +
  'var R = [], errores = [];\n' +
  'window.addEventListener("error", function (e) { errores.push(String(e.message)); });\n' +
  'function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }\n' +
  'async function hasta(fn, tope) { for (var t = 0; !fn() && t < (tope || 4000); t += 25) await espera(25); return fn(); }\n' +
  'function apunta(caso, v) { R.push([caso, v]); }\n' +
  'function lineas(sel) { return Array.prototype.map.call(document.querySelectorAll(sel + " .datos-info-linea"), function (d) { return d.textContent; }); }\n' +
  'function consultado(sel) { return lineas(sel).filter(function (l) { return /^Consultado: \\d\\d\\/\\d\\d\\/\\d{4} · \\d\\d:\\d\\d$/.test(l); })[0] || null; }\n' +
  'function aviso(sel) { return lineas(sel).some(function (l) { return /No se pudo actualizar/.test(l); }); }\n' +
  'function cerrar() { var pre = document.createElement("pre"); pre.id = "__res";\n' +
  '  pre.textContent = JSON.stringify({ errores: errores, r: R }); document.body.appendChild(pre); }\n';

function conComun(cuerpo) {
  return new Function(COMUN + '(async function () { try {\n' + cuerpo + '\n} catch (e) { errores.push("sonda: " + e.message); } cerrar(); })();');
}

// ---------------------------------------------------------------- QA
function respondeQa(u, v) {
  var q = new URL(u, location.href).searchParams;
  if (u.indexOf('backlog_catalogos.ashx') >= 0) return { c1: [], grupos: ['GA'], lideres: [] };
  var a = q.get('action');
  if (a === 'detail') {
    return { rows: [{ 'Código': 'T' + v, Validacion: q.get('validacion') || 'OK', Grupo: 'G1' }], total: 1, page: Number(q.get('page')) || 1 };
  }
  if (a === 'qare') return { validacion: [{ validacion: 'Incorrecto', tickets: 10 * v }, { validacion: 'OK', tickets: 90 * v }] };
  return { summary: { totalTickets: 100 * v, incorrectos: 10 * v, incorrectosPct: 10 },
    source: { fechaInicio: '2026-10-15', fechaFin: '2026-10-29' },
    dataInfo: { ultimaActualizacion: SELLO[v], periodoInicio: '2026-10-15', periodoFin: '2026-10-29', tipoPeriodo: 'rango' },
    porGrupo: [{ grupo: 'G1', tickets: 8 * v }], porTecnico: [{ tecnico: 'Tec', tickets: 3 * v }],
    recategorizacion: [{ grupo: 'G1', grupoCorrecto: 'G2', tickets: v }], validacion: null };
}
function claveQa(u) {
  if (u.indexOf('backlog_catalogos.ashx') >= 0) return 'catalogos';
  if (u.indexOf('qa.ashx') < 0) return null;
  var q = new URL(u, location.href).searchParams;
  var a = q.get('action');
  return a === 'summary' ? (q.get('fecha_inicio') ? 'summary-vista' : 'summary-base') : a;
}
var sondaQa = conComun(
  'var M = function () { return window.TableroQaModulo; };\n' +
  'function total() { var k = document.querySelector("#qa-kpis .kpi .kpi-val"); return k ? k.textContent : null; }\n' +
  'function barras() { var c = Chart.getChart(document.getElementById("qa-chart-grupo")); return c ? c.data.datasets[0].data.slice() : null; }\n' +
  'await hasta(function () { return total() === "100" && !!consultado("#qa-chip-fecha") && M(); });\n' +
  'apunta("Q1", [total(), !!consultado("#qa-chip-fecha"), lineas("#qa-chip-fecha").some(function (l) { return /29\\/10\\/2026 · 08:00/.test(l); })]);\n' +
  // Rango propio (dia de inicio distinto) y detalle abierto.
  'var fi = document.getElementById("qa-f-inicio"); fi.value = "2026-10-16"; fi.dispatchEvent(new Event("change"));\n' +
  'await hasta(function () { return (__pedidas["summary-vista"] || 0) >= 1 && total() === "100"; });\n' +
  'document.getElementById("qa-btn-detalle").click();\n' +
  'await hasta(function () { return !document.getElementById("qa-detalle-panel").hidden; });\n' +
  'await espera(100);\n' +
  'var p0 = Object.assign({}, __pedidas), u0 = __urls.length;\n' +
  'window.__v = 2; window.__lento = 300;\n' +
  'var r = M().refrescar();\n' +
  'await espera(150);\n' +
  'var durante = [total(), document.getElementById("qa-tbody-recat").textContent.indexOf("Calculando") >= 0];\n' +
  'await r; window.__lento = 0; await espera(50);\n' +
  'var nuevas = __urls.slice(u0);\n' +
  'var det = nuevas.filter(function (u) { return /action=detail/.test(u); }).map(function (u) { var q = new URL(u).searchParams; return [q.get("validacion"), q.get("page"), q.get("fecha_inicio")]; });\n' +
  'apunta("Q2", [durante, total(), barras(), fi.value, (__pedidas["summary-vista"] || 0) - (p0["summary-vista"] || 0),\n' +
  '  (__pedidas["summary-base"] || 0) - (p0["summary-base"] || 0), det, !document.getElementById("qa-detalle-panel").hidden,\n' +
  '  lineas("#qa-chip-fecha").some(function (l) { return /30\\/10\\/2026 · 09:15/.test(l); }), !!consultado("#qa-chip-fecha")]);\n' +
  // Q3 dos a la vez.
  'var s0 = __pedidas["summary-vista"]; window.__lento = 200;\n' +
  'var a = M().refrescar(), b = M().refrescar(); await Promise.all([a, b]); window.__lento = 0;\n' +
  'apunta("Q3", __pedidas["summary-vista"] - s0);\n' +
  // Q4 fallo.
  'var c0 = consultado("#qa-chip-fecha"); window.__v = 3; window.__falla = true;\n' +
  'await M().refrescar(); window.__falla = false;\n' +
  'apunta("Q4", [total(), aviso("#qa-chip-fecha"), consultado("#qa-chip-fecha") === c0, barras()]);\n' +
  // Q5 Actualizar.
  'document.getElementById("qa-btn-actualizar").click();\n' +
  'await hasta(function () { return total() === "300"; });\n' +
  'apunta("Q5", [total(), aviso("#qa-chip-fecha")]);\n');

// ---------------------------------------------------------- Efectividad
function respondeEf(u, v) {
  var filas = [];
  function fila(folio, orden, prefijo, extra) {
    var r = { folio: folio, orden: orden, prefijo: prefijo, titulo: 'Titulo ' + folio, categoria: '/A/' + folio, c1: '/A',
      c1c2: '/A/' + folio, comp: 10, logro: 5, asignada: 0, evitados: 1, reduccion_hoy: 1, evalua_rebote: false, estado: 'Cerrado' };
    Object.keys(extra || {}).forEach(function (k) { r[k] = extra[k]; });
    filas.push(r);
  }
  fila('M1', 15, 'PRB'); fila('M2', 15, 'REQ'); fila('M3', 15, 'REQ');
  if (v >= 2) fila('M9', 15, 'REQ');
  fila('E1', 14, 'REQ', { se_mide_desde: '2026-11-01' });
  fila('N1', 3, 'REQ', { motivo: 'Sin fecha' }); fila('N2', 3, 'PRB', { motivo: 'Sin fecha' });
  return { hay_calculo: true, filas: filas, categorias: [], corrida: { fecha_calculo: v >= 2 ? '2026-10-23 06:10' : '2026-10-22 06:10' } };
}
function claveEf(u) { return u.indexOf('efectividad.ashx') >= 0 ? 'ef' : null; }
var sondaEf = conComun(
  'var M = function () { return window.TableroEfectividadModulo; };\n' +
  'function folios() { return Array.prototype.map.call(document.querySelectorAll("#ef-t-medidas tbody tr.abre"), function (tr) { return tr.getAttribute("data-folio"); }).sort(); }\n' +
  'function hoja() { var b = document.querySelector("#ef-pestanas [aria-selected=\\"true\\"]"); return b && b.getAttribute("data-hoja"); }\n' +
  'await hasta(function () { return folios().length > 0 && !!consultado("#ef-estado"); });\n' +
  'apunta("E1", [lineas("#ef-estado")[0], !!consultado("#ef-estado")]);\n' +
  // E2 boleta abierta.
  'document.querySelector("#ef-t-medidas tbody tr.abre").click();\n' +
  'await hasta(function () { return document.getElementById("ef-boleta").open; });\n' +
  'var conBoleta = M().puedeRefrescar();\n' +
  'document.getElementById("ef-b-cerrar").click();\n' +
  'apunta("E2", [conBoleta, M().puedeRefrescar()]);\n' +
  // E3 filtros, busqueda, hoja y motivo desplegado.
  'var t = document.getElementById("ef-tipo"); t.value = "REQ"; t.dispatchEvent(new Event("change"));\n' +
  'var bu = document.getElementById("ef-buscar"); bu.value = "M"; bu.dispatchEvent(new Event("input"));\n' +
  'document.querySelector("#ef-pestanas [data-hoja=\\"sin\\"]").click();\n' +
  'var d = document.querySelector("#ef-sin-grupos details[data-motivo]"); d.open = true;\n' +
  'var clave = d.getAttribute("data-motivo"); var n0 = __pedidas.ef;\n' +
  'window.__v = 2; await M().refrescar();\n' +
  'var abierto = document.querySelector("#ef-sin-grupos details[data-motivo=\\"" + clave + "\\"]");\n' +
  'apunta("E3", [__pedidas.ef - n0, t.value, bu.value, hoja(), !!(abierto && abierto.open), folios(), lineas("#ef-estado")[0], !!consultado("#ef-estado")]);\n' +
  // E4 fallo.
  'var c0 = consultado("#ef-estado"); window.__falla = true; await M().refrescar(); window.__falla = false;\n' +
  'apunta("E4", [aviso("#ef-estado"), consultado("#ef-estado") === c0, folios(), t.value, document.getElementById("ef-error").hidden]);\n');

// ---------------------------------------------------------- Orquestacion
function respondeOrq(u, v) {
  var COLS = ['JobId', 'Dir', 'N3', 'Herramienta', 'Candidato', 'EsHuerfano', 'Activo', 'OrqCompleto',
              'CamposLlenosExcel', 'CamposLlenosEstricta', 'CandSi', 'PendMigrar', 'Prom'];
  var n = v >= 2 ? 41 : 40, filas = [], det = [];
  for (var i = 1; i <= n; i++) {
    filas.push([i, i <= 20 ? 'Dir A' : 'Dir B', 'N3 ' + (i % 3), 'Herr ' + (i % 2), i % 3 === 0 ? 'Si' : 'No',
                0, i % 2, 0, 10, 8, 0, 0, 1.5]);
    det.push([i, 'JOB_' + i, i + 1, 'H', 'Activo', 'Si', 1.5, 'E', 'App', 1, '', 0]);
  }
  if (u.indexOf('detalle=1') >= 0) {
    return { detalle: { cols: ['JobId', 'JobName', 'FilaExcel', 'Herramienta', 'EstatusControlM', 'EsCandidato',
      'PromedioDiario', 'EsquemaConsiderado', 'Aplicacion', 'AplicacionEnCatalogo', 'Advertencias', 'PersonasFueraDeDatos'], filas: det } };
  }
  return { hay_datos: true, jobs: { cols: COLS, filas: filas }, decomisos: { cols: [], filas: [] },
    historico: { cols: ['Fecha', 'Origen', 'MigradosNuevos'], filas: [['2026-10-01', 'Excel', 1]] }, campos: [], parametros: {},
    carga: { fecha: '2026-10-2' + v, numero: v >= 2 ? 2 : 1 },
    meta: { ultimaActualizacion: SELLO[v], tipoPeriodo: 'corte' }, hoy: '2026-10-30' };
}
function claveOrq(u) { return u.indexOf('orquestacion.ashx') < 0 ? null : (u.indexOf('detalle=1') >= 0 ? 'detalle' : 'orq'); }
var sondaOrq = conComun(
  'var M = function () { return window.TableroOrquestacionModulo; };\n' +
  'function filasLista() { return document.querySelectorAll("#orq-t-jobs tbody tr").length; }\n' +
  'await hasta(function () { return !!consultado("#orq-estado") && M(); });\n' +
  'apunta("O1", [lineas("#orq-estado")[0], !!consultado("#orq-estado")]);\n' +
  'var dir = document.getElementById("orq-dir"); dir.value = "Dir B"; dir.dispatchEvent(new Event("change"));\n' +
  'var hi = document.getElementById("orq-h-ind"); var otro = hi.options[hi.options.length - 1].value; hi.value = otro; hi.dispatchEvent(new Event("change"));\n' +
  'document.getElementById("orq-ver-jobs").click();\n' +
  'await hasta(function () { return !document.getElementById("orq-lista").hidden && filasLista() > 0; });\n' +
  'var f0 = filasLista(), d0 = __pedidas.detalle;\n' +
  // Misma carga: la lista no se vuelve a pedir.
  'await M().refrescar();\n' +
  'var mismaCarga = __pedidas.detalle - d0;\n' +
  'window.__v = 2; await M().refrescar(); await hasta(function () { return filasLista() === f0 + 1; });\n' +
  'apunta("O2", [mismaCarga, __pedidas.detalle - d0, dir.value, hi.value === otro, !document.getElementById("orq-lista").hidden,\n' +
  '  filasLista() - f0, lineas("#orq-estado").some(function (l) { return /30\\/10\\/2026 · 09:15/.test(l); }), !!consultado("#orq-estado")]);\n' +
  'var c0 = consultado("#orq-estado"); window.__falla = true; await M().refrescar(); window.__falla = false;\n' +
  'apunta("O3", [aviso("#orq-estado"), consultado("#orq-estado") === c0, dir.value, filasLista() - f0, document.getElementById("orq-error").hidden]);\n');

// ---------------------------------------------------------- Experiencia
// La respuesta del handler es el mock guardado, con meta (sello por version).
function respondeExp(u, v) {
  if (u.indexOf('kpis.ashx') >= 0) return { TicketsAutomatizados: 2 };
  return window.__fetchOriginal('data/experiencia.mock.json').then(function (r) { return r.text(); }).then(function (t) {
    var d = JSON.parse(t.replace(/^\uFEFF/, ''));
    d.meta = { ultimaActualizacion: SELLO[v], periodoInicio: '2026-09-29', periodoFin: '2026-10-28', tipoPeriodo: 'rango' };
    return d;
  });
}
function claveExp(u) { return u.indexOf('experiencia.ashx') >= 0 ? 'exp' : (u.indexOf('kpis.ashx') >= 0 ? 'kpis' : null); }
var sondaExp = conComun(
  'var M = function () { return window.TableroExperienciaModulo; };\n' +
  'function abiertas() { return Array.prototype.map.call(document.querySelectorAll("#bodyDet tr.c1row.open"), function (tr) { return tr.cells[0].textContent.trim(); }); }\n' +
  'await hasta(function () { return !!consultado("#corteFecha") && M() && document.querySelector("#bodyDet tr.c1row"); }, 8000);\n' +
  'apunta("X1", [!!consultado("#corteFecha"), document.querySelectorAll(".exp-aviso-origen").length]);\n' +
  'var mb = document.getElementById("modalBk"); mb.classList.add("show");\n' +
  'var conModal = M().puedeRefrescar(); mb.classList.remove("show");\n' +
  'apunta("X2", [conModal, M().puedeRefrescar()]);\n' +
  // El primer Director con filas en el Detalle.
  'var sd = document.getElementById("selDir"), dir = null;\n' +
  'for (var i = 1; i < sd.options.length && !dir; i++) { sd.value = sd.options[i].value; sd.dispatchEvent(new Event("change"));\n' +
  '  if (document.querySelector("#bodyDet tr.c1row")) dir = sd.value; }\n' +
  'var sm = document.getElementById("selModo"); if (sm) { sm.value = "mes"; sm.dispatchEvent(new Event("change")); }\n' +
  'await espera(50);\n' +
  'var fila = document.querySelector("#bodyDet tr.c1row"); fila.onclick({ target: fila });\n' +
  'var antes = abiertas(), n0 = __pedidas.exp;\n' +
  'window.__v = 2; await M().refrescar();\n' +
  'apunta("X3", [__pedidas.exp - n0, sd.value === dir, sm ? sm.value : "mes", antes.length === 1 && JSON.stringify(abiertas()) === JSON.stringify(antes),\n' +
  '  lineas("#corteFecha").some(function (l) { return /30\\/10\\/2026 · 09:15/.test(l); }), !!consultado("#corteFecha")]);\n' +
  'var c0 = consultado("#corteFecha"); window.__falla = true; await M().refrescar(); window.__falla = false;\n' +
  'apunta("X4", [aviso("#corteFecha"), consultado("#corteFecha") === c0, sd.value === dir, JSON.stringify(abiertas()) === JSON.stringify(antes)]);\n');

// -------------------------------------------------------------- Tablero
function claveDash(u) {
  if (u.indexOf('efectividad.ashx') >= 0) return 'ef';
  if (/efectividad\/efectividad\.html/.test(u)) { window.__marcado = (window.__marcado || 0) + 1; }
  return null;
}
var sondaDash = conComun(
  'function ef() { return __pedidas.ef || 0; }\n' +
  'await hasta(function () { return ef() >= 1 && document.querySelector("#ef-t-medidas tbody tr.abre"); }, 8000);\n' +
  // D1 sola, a la vista.
  'var a = ef(); await espera(1900);\n' +
  'apunta("D1", ef() - a >= 1);\n' +
  // D2 en otra pestaña no pide; al volver, una vez y sin montar de nuevo.
  'activarTab("sla"); await espera(200); var b = ef(); await espera(3500);\n' +
  'var fuera = ef() - b;\n' +
  'activarTab("efectividad"); await espera(300);\n' +
  'apunta("D2", [fuera, ef() - b, document.querySelectorAll("script[src*=\\"efectividad.js\\"]").length, window.__marcado || 0]);\n' +
  // D3 boleta abierta: no se refresca.
  'document.querySelector("#ef-t-medidas tbody tr.abre").click();\n' +
  'await hasta(function () { return document.getElementById("ef-boleta").open; });\n' +
  'var c = ef(); await espera(3500);\n' +
  'apunta("D3", ef() - c);\n' +
  'document.getElementById("ef-b-cerrar").click();\n');

var ESCAPE = '<script src="../assets/js/escape.js"></script>\n';
var paginas = {
  '/qa/__banco.html': Banco.pagina('qa/qa.html', 'qa.js', stub(respondeQa, claveQa), sondaQa),
  '/efectividad/__banco.html': Banco.pagina('efectividad/efectividad.html', 'efectividad.js', ESCAPE + stub(respondeEf, claveEf), sondaEf),
  '/orquestacion/__banco.html': Banco.pagina('orquestacion/orquestacion.html', 'orquestacion.js', stub(respondeOrq, claveOrq), sondaOrq),
  '/experiencia/__banco.html': Banco.pagina('experiencia/experiencia.html', 'experiencia.js', stub(respondeExp, claveExp), sondaExp),
  '/__banco_dash.html': Banco.pagina('dashboard.html', 'dashboard.js',
    '<script>window.MockData.MOCK_DATA = true; window.RefrescoAuto.INTERVALO_DATOS = 1500;</script>\n' + stub(respondeEf, claveDash), sondaDash),
};
var urls = ['/qa/__banco.html', '/efectividad/__banco.html', '/orquestacion/__banco.html', '/experiencia/__banco.html', '/__banco_dash.html#efectividad'];

Banco.correr(paginas, urls, 60000).then(function (res) {
  function seccion(i, nombre, fn) {
    if (!res[i]) { console.log('FAIL  ' + nombre + ': Chrome no devolvio el resultado de la sonda'); fallos++; return; }
    Check(nombre + ' sin errores de JS', [], res[i].errores);
    fn(Banco.mapa(res[i]));
  }
  seccion(0, 'Q', function (o) {
    Check('Q1 QA arranque: cifras, "Consultado" y sello', ['100', true, true], o.Q1);
    Check('Q2 refresco: sin "—" ni "Calculando…" mientras pide; cifras y Top 10 nuevos; fechas igual; UNA vista y UNA base; detalle con sus filtros y pagina; sello y "Consultado"',
      [['100', false], '200', [16], '2026-10-16', 1, 1, [['Incorrecto', '1', '2026-10-16']], true, true, true], o.Q2);
    Check('Q3 dos refrescos a la vez: una peticion', 1, o.Q3);
    Check('Q4 fallo: cifras, "Consultado" y Top 10 de antes, con aviso', ['200', true, true, [16]], o.Q4);
    Check('Q5 Actualizar trae lo nuevo y quita el aviso', ['300', false], o.Q5);
  });
  seccion(1, 'E', function (o) {
    Check('E1 Efectividad arranque: calculo y "Consultado"', ['Cálculo del 22/10/2026 06:10', true], o.E1);
    Check('E2 con la boleta abierta no se refresca; cerrada si', [false, true], o.E2);
    Check('E3 refresco: una peticion; tipo, busqueda, hoja y motivo abierto se quedan; folio nuevo; calculo nuevo',
      [1, 'REQ', 'M', 'sin', true, ['M2', 'M3', 'M9'], 'Cálculo del 23/10/2026 06:10', true], o.E3);
    Check('E4 fallo: aviso; "Consultado", filas y filtro de antes; sin banda de error', [true, true, ['M2', 'M3', 'M9'], 'REQ', true], o.E4);
  });
  seccion(2, 'O', function (o) {
    Check('O1 Orquestacion arranque: sello y "Consultado"', ['Carga del Excel: 29/10/2026 · 08:00', true], o.O1);
    Check('O2 refresco: misma carga no repide la lista; otra carga si (una vez); Direccion, historico y lista se quedan; job nuevo; sello',
      [0, 1, 'Dir B', true, true, 1, true, true], o.O2);
    Check('O3 fallo: aviso; "Consultado", filtro y lista de antes; sin banda de error', [true, true, 'Dir B', 1, true], o.O3);
  });
  seccion(3, 'X', function (o) {
    Check('X1 Experiencia arranque en vivo: "Consultado", sin aviso de respaldo', [true, 0], o.X1);
    Check('X2 con un modal abierto no se refresca; cerrado si', [false, true], o.X2);
    Check('X3 refresco: una peticion; Director, "Ver por" y fila desplegada se quedan; sello y "Consultado"',
      [1, true, 'mes', true, true, true], o.X3);
    Check('X4 fallo: aviso; "Consultado", Director y fila de antes', [true, true, true, true], o.X4);
  });
  seccion(4, 'D', function (o) {
    Check('D1 tablero: la pestaña a la vista se refresca sola', true, o.D1);
    Check('D2 en otra pestaña no pide; al volver una vez; sin montar de nuevo (1 script, 1 marcado)', [0, 1, 1, 1], o.D2);
    Check('D3 con la boleta abierta no se refresca', 0, o.D3);
  });
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
