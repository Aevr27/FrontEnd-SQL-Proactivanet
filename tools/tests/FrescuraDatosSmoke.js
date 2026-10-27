// tools/tests/FrescuraDatosSmoke.js - prueba de humo de lo que el tablero dice
// sobre el ORIGEN y la FRESCURA de sus datos, y de los textos de filtros.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca.
//
// Partes:
//   D) DatosInfo (assets/js/datos-info.js): rotulo por omision, rotuloSello,
//      y que sin fecha no se inventa ninguna.
//   E) Experiencia, pintarCorteExperiencia (experiencia/experiencia.js): en
//      vivo "Última actualización"; con el respaldo, "Datos de respaldo, no
//      en vivo · Corte: <fecha guardada>"; respaldo sin fecha, un aviso sin
//      fecha.
//   O) Orquestacion (orquestacion/orquestacion.js): la cabecera lleva la
//      pastilla .datos-info con "Carga del Excel: <sello tal cual> · N jobs";
//      sin sello, solo los jobs; vacia, sin pastilla.
//   T) Tablero legacy (dashboard.js, TableroExterno): la fecha "Generado el"
//      del pie se repite en la cabecera de Observabilidad y Orquestacion como
//      instantanea; sin pie no se pinta nada; no se duplica. Incluye el pie
//      del assets/Tablero_Experiencia.html real.
//   F) Filtro por clic de SLA (textoFiltroClic): rotulos y escape.
//   M) MOCK_DATA: la pastilla de SLA/Call Center y la de Backlog avisan de
//      datos simulados solo con MOCK_DATA, y mock-data.js sigue en false.
//   L) Los "Limpiar" de SLA/Call Center, Backlog y Experiencia dicen que
//      reinician (title), igual que lo que hace su manejador.
//
// Las funciones se recortan del ARCHIVO REAL y se evaluan sueltas (mismo
// patron que NavegacionModulosSmoke.js): se prueba el codigo publicado.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\FrescuraDatosSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r\n/g, '\n'); }

var fallos = 0;
function Check(nombre, esperado, obtenido) {
  var ok = JSON.stringify(esperado) === JSON.stringify(obtenido);
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (ok ? '' : '  esperado=' + JSON.stringify(esperado) + '  obtenido=' + JSON.stringify(obtenido)));
}

function recortar(fuente, re, nombre) {
  var m = re.exec(fuente);
  if (!m) { console.log('FAIL  no encontre ' + nombre); process.exit(1); }
  return m[0];
}

// ---- DOM minimo ----
function Nodo(tag) {
  var n = {
    tagName: tag, hijos: [], atributos: {}, style: {}, className: '', title: '',
    _texto: '',
    classList: {
      clases: {},
      add: function (c) { this.clases[c] = true; },
      remove: function (c) { delete this.clases[c]; },
      contains: function (c) { return !!this.clases[c]; }
    },
    appendChild: function (h) { h.padre = n; n.hijos.push(h); return h; },
    setAttribute: function (k, v) { n.atributos[k] = String(v); },
    removeAttribute: function (k) { delete n.atributos[k]; if (k === 'title') n.title = ''; },
    insertAdjacentElement: function (donde, h) {
      var p = n.padre; h.padre = p;
      p.hijos.splice(p.hijos.indexOf(n) + 1, 0, h);
      return h;
    },
    querySelector: function (sel) { return buscar(n, sel); }
  };
  Object.defineProperty(n, 'textContent', {
    get: function () { return n._texto + n.hijos.map(function (h) { return h.textContent; }).join(''); },
    set: function (v) { n._texto = String(v); n.hijos = []; }
  });
  return n;
}
// Selectores que usa el codigo: 'footer', 'header.top', '.sub', '[data-instantanea]'.
function casa(n, sel) {
  if (sel === '[data-instantanea]') return Object.prototype.hasOwnProperty.call(n.atributos, 'data-instantanea');
  if (sel === '.sub') return n.className.split(' ').indexOf('sub') >= 0;
  var p = sel.split('.');
  return n.tagName === p[0] && (!p[1] || n.className.split(' ').indexOf(p[1]) >= 0);
}
function buscar(n, sel) {
  for (var i = 0; i < n.hijos.length; i++) {
    var h = n.hijos[i];
    if (casa(h, sel)) return h;
    var r = buscar(h, sel);
    if (r) return r;
  }
  return null;
}
function Documento() {
  var ids = {};
  return {
    ids: ids,
    createElement: function (tag) { return Nodo(tag); },
    getElementById: function (id) { return ids[id] || null; }
  };
}
function lineasDe(nodo) { return nodo.hijos.map(function (h) { return h.textContent; }); }

// ---- D) DatosInfo ----
var ventana = {};
var docGlobal = Documento();
(new Function('window', 'document', leer('assets/js/datos-info.js')))(ventana, docGlobal);
var DatosInfo = ventana.DatosInfo;

var n1 = Nodo('div');
DatosInfo.pintar(n1, { ultimaActualizacion: '2026-10-12T08:30:00', tipoPeriodo: 'corte' });
Check('D1 por omision: "Última actualización"', ['Última actualización: 12/10/2026 · 08:30'], lineasDe(n1));
var n2 = Nodo('div');
DatosInfo.pintar(n2, { ultimaActualizacion: '2026-09-02', tipoPeriodo: 'corte' }, { rotuloSello: 'Datos de respaldo, no en vivo · Corte' });
Check('D2 rotuloSello cambia solo el rotulo; la fecha es la del metadato', ['Datos de respaldo, no en vivo · Corte: 02/09/2026'], lineasDe(n2));
var n3 = Nodo('div');
DatosInfo.pintar(n3, {}, { rotuloSello: 'Datos de respaldo, no en vivo · Corte' });
Check('D3 sin fecha no se inventa ninguna (nodo vacio)', [[], false], [lineasDe(n3), n3.classList.contains('datos-info')]);

// ---- E) Experiencia ----
var fuenteExp = leer('experiencia/experiencia.js');
var pintarCorte = new Function('DatosInfo',
  recortar(fuenteExp, /function pintarCorteExperiencia\(cf, P, respaldo\)\{[\s\S]*?\n\}/, 'pintarCorteExperiencia') +
  '\nreturn pintarCorteExperiencia;')(DatosInfo);
var cf = Nodo('div');
pintarCorte(cf, { meta: { ultimaActualizacion: '2026-10-12T07:00:00', periodoInicio: '2026-09-12', periodoFin: '2026-10-11', tipoPeriodo: 'rango' } }, false);
Check('E1 en vivo: sello y periodo del servidor', ['Última actualización: 12/10/2026 · 07:00', 'Periodo: 12/09/2026 – 11/10/2026'], lineasDe(cf));
cf = Nodo('div');
pintarCorte(cf, { fecha_actualizacion: '02/09/2026' }, true);
Check('E2 respaldo: lo dice y usa la fecha guardada en el archivo', ['Datos de respaldo, no en vivo · Corte: 02/09/2026'], lineasDe(cf));
cf = Nodo('div');
pintarCorte(cf, {}, true);
Check('E3 respaldo sin fecha: aviso sin fecha', ['Datos de respaldo, no en vivo · sin fecha de corte'], lineasDe(cf));
cf = Nodo('div');
pintarCorte(cf, {}, false);
Check('E4 en vivo sin metadato: nada (no se inventa)', [], lineasDe(cf));
cf = Nodo('div');
pintarCorte(cf, { meta: { ultimaActualizacion: '2026-09-02', tipoPeriodo: 'corte' } }, true);
Check('E5 respaldo con meta: tambien dice respaldo', ['Datos de respaldo, no en vivo · Corte: 02/09/2026'], lineasDe(cf));
Check('E6 se llama con !!errApi tras cargar', true, /pintarCorteExperiencia\(document\.getElementById\('corteFecha'\), P, !!errApi\);/.test(fuenteExp));
Check('E7 el aviso de arriba dice "no en vivo"', true, /<b>Datos de respaldo, no en vivo\.<\/b>/.test(fuenteExp));
var mockExp = JSON.parse(fs.readFileSync(path.join(raiz, 'experiencia', 'data', 'experiencia.mock.json'), 'utf8').replace(/^﻿/, ''));
Check('E8 el respaldo real trae su propia fecha (dd/mm/aaaa)', true, /^\d{2}\/\d{2}\/\d{4}$/.test(mockExp.fecha_actualizacion));

// ---- O) Orquestacion: pastilla blanca del sello en la cabecera ----
var fuenteOrq = leer('orquestacion/orquestacion.js');
var docOrq = Documento();
var orq = new Function('DatosInfo', 'document', 'n0',
  "var PREFIJO = 'orq-';\n" +
  recortar(fuenteOrq, /  function \$\(id\) \{[^\n]*\}/, '$ orquestacion') + '\n' +
  recortar(fuenteOrq, /  function estado\(txt\) \{[\s\S]*?\n  \}/, 'estado orquestacion') + '\n' +
  recortar(fuenteOrq, /  function estadoCarga\(j, nJobs\) \{[\s\S]*?\n  \}/, 'estadoCarga orquestacion') +
  '\nreturn { estado: estado, carga: estadoCarga };')(DatosInfo, docOrq, function (v) { return String(v); });
var est = Nodo('div'); docOrq.ids['orq-estado'] = est;
orq.carga({ meta: { ultimaActualizacion: '2026-10-26T09:15:00', tipoPeriodo: 'corte' },
            carga: { fecha: '2026-10-26 09:15' } }, 1234);
Check('O1 con sello: pastilla .datos-info con la carga del Excel tal cual (09:15) y los jobs',
  [['Carga del Excel: 26/10/2026 · 09:15 · 1234 jobs'], true], [lineasDe(est), est.classList.contains('datos-info')]);
est = Nodo('div'); docOrq.ids['orq-estado'] = est;
orq.carga({ meta: { ultimaActualizacion: null, tipoPeriodo: 'corte' }, carga: {} }, 7);
Check('O2 sin sello: no se inventa fecha, queda el numero de jobs en la pastilla',
  [['7 jobs'], true], [lineasDe(est), est.classList.contains('datos-info')]);
est = Nodo('div'); docOrq.ids['orq-estado'] = est;
orq.carga({ carga: { fecha: '2026-10-26 09:15' } }, 3);
Check('O3 sin meta (handler viejo): cae a carga.fecha, sin correrla',
  ['Carga del Excel: 26/10/2026 · 09:15 · 3 jobs'], lineasDe(est));
orq.estado('Cargando…');
Check('O4 mensaje en la misma pastilla', [['Cargando…'], true], [lineasDe(est), est.classList.contains('datos-info')]);
orq.estado('');
Check('O5 vacio: sin pastilla (no deja hueco en la cabecera)', [[], false], [lineasDe(est), est.classList.contains('datos-info')]);
Check('O6 cargar() pinta la pastilla con los jobs de la respuesta', true, /estadoCarga\(j, jobs\.length\);/.test(fuenteOrq));
var htmlOrq = leer('orquestacion/orquestacion.html');
Check('O7 la pagina suelta carga datos-info.js y datos-info.css', [true, true],
  [/<script src="\.\.\/assets\/js\/datos-info\.js"><\/script>/.test(htmlOrq),
   /<link rel="stylesheet" href="\.\.\/assets\/css\/datos-info\.css">/.test(htmlOrq)]);
Check('O8 el nodo sigue en la cabecera, junto a "Fijar KPIs"', true,
  /<div class="acciones-top">[\s\S]*?kpis-fijar[\s\S]*?<div class="estado" id="orq-estado" role="status"><\/div>/.test(htmlOrq));

// ---- T) Tablero legacy ----
var fuenteDash = leer('dashboard.js');
var legacy = new Function(
  recortar(fuenteDash, /  function fechaGeneradoLegacy\(texto\) \{[\s\S]*?\n  \}/, 'fechaGeneradoLegacy') + '\n' +
  recortar(fuenteDash, /  function marcarInstantaneaLegacy\(doc\) \{[\s\S]*?\n  \}/, 'marcarInstantaneaLegacy') +
  '\nreturn { fecha: fechaGeneradoLegacy, marcar: marcarInstantaneaLegacy };')();
Check('T1 fecha del pie', ['09/09/2026', null, null],
  [legacy.fecha('Generado el 09/09/2026 · Fuente: x'), legacy.fecha('Fuente: x'), legacy.fecha(null)]);

function Panel(doc, id, pie) {
  var panel = Nodo('div'); doc.ids[id] = panel;
  var cab = panel.appendChild(Nodo('header')); cab.className = 'top';
  cab.appendChild(Nodo('h1')).textContent = 'Titulo';
  var sub = cab.appendChild(Nodo('div')); sub.className = 'sub'; sub.textContent = 'Subtitulo';
  cab.appendChild(Nodo('div')).className = 'selrow';
  if (pie !== null) panel.appendChild(Nodo('footer')).textContent = pie;
  return cab;
}
var doc = Documento();
var cabOb = Panel(doc, 'tab-observabilidad', 'Generado el 09/09/2026 · Fuente: algo.');
var cabOr = Panel(doc, 'tab-orquestacion', null);
legacy.marcar(doc);
Check('T2 Observabilidad: la instantanea va justo debajo del subtitulo, con la fecha del pie', [
  'sub', 'Instantánea generada el 09/09/2026 · no se actualiza en vivo', 'selrow'],
  [cabOb.hijos[2].className, cabOb.hijos[2].textContent, cabOb.hijos[3].className]);
Check('T3 Orquestacion sin pie: no se pinta nada', [3, null], [cabOr.hijos.length, cabOr.querySelector('[data-instantanea]')]);
legacy.marcar(doc);
Check('T4 volver a marcar no la duplica', 4, cabOb.hijos.length);
Check('T5 se llama al cargar el marco', true, /recolorearLegacy\(doc\);\n    marcarInstantaneaLegacy\(doc\);/.test(fuenteDash));
// El archivo real: los pies de los dos paneles traen la fecha.
var real = fs.readFileSync(path.join(raiz, 'assets', 'Tablero_Experiencia.html'), 'utf8');
['tab-observabilidad', 'tab-orquestacion'].forEach(function (id) {
  var ini = real.indexOf('id="' + id + '"');
  var pie = ini < 0 ? null : /<footer>([\s\S]*?)<\/footer>/.exec(real.slice(ini));
  Check('T6 ' + id + ': el pie del archivo generado trae "Generado el dd/mm/aaaa"', true,
    !!(pie && legacy.fecha(pie[1])));
});

// ---- F) filtro por clic de SLA ----
var Escape = (function () { var v = {}; (new Function('window', leer('assets/js/escape.js')))(v); return v.Escape; })();
var textoFiltroClic = new Function('escapeHtml',
  recortar(fuenteDash, /function dimensionesActivas\(filtro\) \{[\s\S]*?\n\}/, 'dimensionesActivas') + '\n' +
  recortar(fuenteDash, /function textoFiltroClic\(filtro, etiquetas\) \{[\s\S]*?\n\}/, 'textoFiltroClic') +
  '\nreturn textoFiltroClic;')(function (s) { return Escape.html(s); });
var ETQ = { prioridad: 'Prioridad', sla: 'SLA' };
Check('F1 sin filtros: vacio', '', textoFiltroClic({ prioridad: null, sla: null }, ETQ));
Check('F2 rotulo y valor de cada dimension activa', 'Prioridad: Alta · SLA: Vencido', textoFiltroClic({ prioridad: 'Alta', sla: 'Vencido' }, ETQ));
Check('F3 escapado (va a innerHTML)', 'Prioridad: &lt;b&gt;x&lt;/b&gt;', textoFiltroClic({ prioridad: '<b>x</b>', sla: null }, ETQ));
Check('F4 el pie de "Resueltos (filtrado)" lo usa', true,
  /const deN = `por clic: \$\{textoFiltroClic\(filtro, ETIQUETA_DIM\)\} · \$\{FMT\(n\)\} de \$\{FMT\(cargadas\)\} cargados`;/.test(fuenteDash));

// ---- M) MOCK_DATA ----
var conAviso = new Function('window',
  recortar(fuenteDash, /function conAvisoSimulados\(opciones\) \{[\s\S]*?\n\}/, 'conAvisoSimulados') + '\nreturn conAvisoSimulados;');
var opc = { periodo: false };
Check('M1 sin MOCK_DATA: mismas opciones', true, conAviso({ MockData: { MOCK_DATA: false } })(opc) === opc);
Check('M2 con MOCK_DATA: avisa, conserva el sufijo previo', { periodo: false, sufijo: ' · ⚠ sin datos de: x · Datos simulados (MOCK_DATA), no reales' },
  conAviso({ MockData: { MOCK_DATA: true } })({ periodo: false, sufijo: ' · ⚠ sin datos de: x' }));
Check('M3 estadoOk y estadoParcial de SLA pasan por el aviso', 2, (fuenteDash.match(/DatosInfo\.pintar\(id, meta, conAvisoSimulados\(/g) || []).length);
var fuenteBl = leer('backlog/backlog.js');
var visto = null;
var estadoOkBl = function (mock) {
  return new Function('window', 'DatosInfo',
    recortar(fuenteBl, /function estadoOk\(id, meta, opciones\) \{[\s\S]*?\n\}/, 'estadoOk backlog') + '\nreturn estadoOk;')(
    { MockData: { MOCK_DATA: mock } }, { pintar: function (id, meta, op) { visto = op; } });
};
estadoOkBl(false)('x', {}, undefined);
Check('M4 Backlog sin MOCK_DATA: sin aviso', undefined, visto);
estadoOkBl(true)('x', {}, undefined);
Check('M5 Backlog con MOCK_DATA: aviso', ' · Datos simulados (MOCK_DATA), no reales', visto && visto.sufijo);
Check('M6 mock-data.js sigue en false', true, /const MOCK_DATA = false;/.test(leer('assets/js/mock-data.js')));

// ---- L) Limpiar ----
var html = leer('dashboard.html');
var bl = leer('backlog/backlog.html');
var ex = leer('experiencia/experiencia.html');
Check('L1 SLA/Call Center: dice que reinicia', true,
  /id="btn-limpiar" type="button"\s+title="Quita Grupos, Técnicos, Campañas y «Sin proveedores», apaga el SLOT, quita los filtros por clic en las gráficas, vuelve al mes en curso y pide los datos de nuevo al servidor">Limpiar<\/button>/.test(html));
Check('L2 Backlog: dice que reinicia y que la fecha de corte se conserva', true,
  /id="btn-limpiar-bl" type="button"\s+title="[^"]*Servicio \/ C1, Grupos y Líderes[^"]*30 días[^"]*La fecha de corte se conserva">Limpiar<\/button>/.test(bl));
Check('L3 Experiencia: dice que reinicia y que «Ver por» se conserva', true,
  /id="btnReset" class="gris"\s+title="[^"]*Director, Product Owner, Manager y Service Owner[^"]*Vencidas y Activas\. «Ver por» se conserva">Limpiar<\/button>/.test(ex));
// Lo que dicen los title es lo que hacen los manejadores.
var limpiarSla = recortar(fuenteDash, /document\.getElementById\('btn-limpiar'\)\.addEventListener\('click', \(\) => \{[\s\S]*?\n    \}\);/, 'Limpiar SLA');
Check('L4 manejador de SLA: grupos, tecnicos, campañas, proveedores, SLOT, rango, filtro por clic, cache', true,
  ["'f-grupos'", "'f-tecnicos'", "'f-campanas'", 'ponerProveedores(false)', 'desactivarSlots()', 'rangoPorDefecto()',
   'filtro[k] = null', 'purgarCacheSla()'].every(function (s) { return limpiarSla.indexOf(s) >= 0; }));
var limpiarBl = recortar(fuenteBl, /document\.getElementById\('btn-limpiar-bl'\)\.addEventListener\('click', \(\) => \{[\s\S]*?\n    \}\);/, 'Limpiar Backlog');
Check('L5 manejador de Backlog: C1, grupos, lideres, 30 dias, Dia; NO toca la fecha de corte', [true, false],
  [["'f-c1-bl'", "'f-grupos-bl'", "'f-lideres-bl'", "'f-dias-bl').value = '30'", "'f-granularidad-bl').value = 'Dia'"]
    .every(function (s) { return limpiarBl.indexOf(s) >= 0; }), limpiarBl.indexOf('f-corte-bl') >= 0]);
var limpiarEx = recortar(fuenteExp, /document\.getElementById\('btnReset'\)\.onclick=\(\)=>\{[\s\S]*?\n\};/, 'Limpiar Experiencia');
Check('L6 manejador de Experiencia: cuatro desplegables y graficas Ven/Act; no toca selModo', [true, false],
  [/fDir='';fPO='';fMgr='';fSO='';/.test(limpiarEx) && /for\(const p of \['ven','act'\]\)/.test(limpiarEx), /selModo|modo/.test(limpiarEx)]);

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
process.exit(fallos ? 1 : 0);
