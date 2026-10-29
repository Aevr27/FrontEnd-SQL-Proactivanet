// tools/tests/DetalleArbolExperienciaSmoke.js - "Detalle por categoria
// (drill-down)" de Experiencia baja, como "Categorias sin iniciativas", por la
// jerarquia completa de categorias_v2: C1 -> C2 -> C3 -> C4 ...
//
// Lo que fija:
//   J)  un C2 con rutas debajo se expande a sus hijas reales (no a filas de
//       iniciativas), y una hija con descendientes se expande a su vez;
//       una ruta intermedia sin fila propia se arma con el segmento;
//   H)  un C2 sin rutas debajo, y una hoja, no son expandibles;
//   M)  metricas de los descendientes: volumen anterior / actual (ruta mas
//       descendientes, SLOT y Mes), Con Iniciativa (conIniVolDe), Tickets en
//       Riesgo y % en Tiempo (iniciativas activas de un agrupador, por ruta),
//       PO / SO; las filas C1 / C2 no cambian;
//   T)  abrir solo muestra los hijos directos; cerrar oculta el subarbol;
//       abrir / cerrar varias veces no duplica filas; cerrar el C1 deja todo
//       colapsado para la siguiente apertura.
//
// NO forma parte del sitio. Recorta las funciones del propio experiencia.js
// (patron de ResumenSubnivelExperienciaSmoke.js) y las corre con un DOM de
// mentira que entiende los selectores que usan los toggles.
//
// Como correrla (desde la raiz del repositorio):
//   node tools\tests\DetalleArbolExperienciaSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var fuente = fs.readFileSync(path.join(raiz, 'experiencia', 'experiencia.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');

function recortar(nombre) {
  var ini = fuente.indexOf('\nfunction ' + nombre + '(');
  if (ini < 0) { console.log('FAIL  ' + nombre + ' no esta en experiencia.js'); process.exit(1); }
  var fin = fuente.indexOf('\n}\n', ini);
  return fuente.slice(ini, fin + 3);
}

// ---- payload con la forma de ExperienciaQueries ------------------------
var MES = 10;
function cat(nivel, c1, categoria, act, ant, ret, iniTotal, iniciativas) {
  return { nivel: nivel, c1: c1, categoria: categoria, vol_actual: act, vol_anterior: ant, delta: act - ant,
    vol_actual_mes: act * 2, vol_anterior_mes: ant * 2, delta_mes: (act - ant) * 2,
    ini_total: iniTotal, ret: ret, pct_en_tiempo: iniTotal > 0 ? 1 - ret / iniTotal : 1,
    director: 'Dir', po: 'PO ' + c1, so: 'SO ' + c1, manager: '', iniciativas: iniciativas || [] };
}
function v2(categoria, act, ant, reduce) {
  var slot = {}, mes = {};
  slot['0'] = act; slot['1'] = ant; mes[String(MES)] = act * 2; mes[String(MES - 1)] = ant * 2;
  return { categoria: categoria, vol_slot: slot, vol_mes: mes, es_hoja: true, ticket_reduce: reduce || 0,
    director: 'Dir', po: 'PO Hoja', so: 'SO Hoja', manager: '' };
}
function ini(folio, estado, retrazado) {
  return { folio: folio, agrup: 'Problem', estado: estado, retrazado: retrazado };
}
// /S-Equipo/Aplicativo: rutas debajo, una de ellas sin fila propia
// (/S-Equipo/Aplicativo/Office solo existe por sus hijas Word y Excel).
// /S-Equipo/Hardware: sin rutas debajo (hoja C2).
var P = {
  mes_actual: MES,
  agrupadores: ['Problem'],
  categorias: [
    cat('C1', 'S-Equipo', 'S-Equipo', 60, 40, 3, 9,
      [ini('F1', 'En Solución', 1), ini('F2', 'En Análisis', 0), ini('F3', 'Cerrado', 0)]),
    cat('C2', 'S-Equipo', '/S-Equipo/Aplicativo', 50, 30, 3, 9,
      [ini('F1', 'En Solución', 1), ini('F2', 'En Análisis', 0), ini('F3', 'Cerrado', 0)]),
    cat('C2', 'S-Equipo', '/S-Equipo/Hardware', 10, 10, 0, 0),
  ],
  categorias_v2: [
    v2('/S-Equipo/Aplicativo', 5, 2),
    v2('/S-Equipo/Aplicativo/Correo', 15, 8, 4),
    v2('/S-Equipo/Aplicativo/Office/Word', 20, 15, 0),
    v2('/S-Equipo/Aplicativo/Office/Excel', 10, 5, 6),
    v2('/S-Equipo/Aplicativo/Viejo', 0, 3, 0),
    v2('/S-Equipo/Hardware', 10, 10),
  ],
  categorias_por_folio: {
    F1: [{ categoria: '/S-Equipo/Aplicativo/Correo', tickets_reduce: 3 }],
    F2: [{ categoria: '/S-Equipo/Aplicativo/Office/Excel', tickets_reduce: 6 }],
    F3: [{ categoria: '/S-Equipo/Aplicativo/Office/Word', tickets_reduce: 50 }],
  },
};

// ---- DOM de mentira ----------------------------------------------------
// innerHTML de bodyDet se parte en filas; querySelectorAll entiende
// '#bodyDet .a.b' y '#bodyDet [data-p="x"]'.
function Fila(html) {
  var clases = (/^<tr class="([^"]*)"/.exec(html) || [, ''])[1].split(/\s+/).filter(Boolean);
  var set = {};
  clases.forEach(function (c) { set[c] = true; });
  var attr = function (n) { var m = new RegExp(n + '="([^"]*)"').exec(html.split('>')[0]); return m ? m[1] : undefined; };
  var f = { html: html, dataset: { g: attr('data-g'), g2: attr('data-g2'), p: attr('data-p') },
    classList: {
      contains: function (c) { return !!set[c]; },
      add: function (c) { set[c] = true; },
      remove: function (c) { delete set[c]; },
      toggle: function (c, on) { if (on === undefined) on = !set[c]; if (on) set[c] = true; else delete set[c]; },
    } };
  f.nombre = (/<td[^>]*>(?:<span[^>]*>)?([^<]*)/.exec(html) || [, ''])[1];
  f.tds = []; html.replace(/<td[^>]*>([\s\S]*?)<\/td>/g, function (_, t) { f.tds.push(t.trim()); });
  return f;
}
var cuerpo = { filas: [], set innerHTML(h) { this.filas = h.split(/(?=<tr )/).filter(function (x) { return /^<tr /.test(x); }).map(Fila); },
  get innerHTML() { return this.filas.map(function (f) { return f.html; }).join(''); } };
var elementos = { bodyDet: cuerpo };
var document = {
  getElementById: function (id) { return elementos[id] || (elementos[id] = { classList: { add: function () {}, remove: function () {} } }); },
  querySelectorAll: function (sel) {
    var resto = sel.replace(/^#bodyDet /, '');
    var m = /^\[data-p="([^"]*)"\]$/.exec(resto);
    if (m) return cuerpo.filas.filter(function (f) { return f.dataset.p === m[1]; });
    var clases = resto.split('.').filter(Boolean);
    return cuerpo.filas.filter(function (f) { return clases.every(function (c) { return f.classList.contains(c); }); });
  },
};

var codigo =
  'var fDir="", fPO="", fMgr="", fSO="", modoTiempo="slot", tipoRegistro="todos";\n' +
  'var _cacheHojaPeriodo={modo:null, tipo:null, set:null};\n' +
  'var AGR=P.agrupadores, ESTADOS_ACTIVOS=' + /const ESTADOS_ACTIVOS=(\[[^\]]*\]);/.exec(fuente)[1] + ';\n' +
  'function FMT(n){return String(n);} function esc(s){return String(s);}\n' +
  'function tend(d){return d>0?"+":d<0?"-":"=";} function miniBar(){return "";} function badge(p){return String(Math.round(p*100))+"%";}\n' +
  'function bindCatClicks(){}\n' +
  ['pasaFiltroGlobal', 'volActualDe', 'volAnteriorDe', 'deltaDe', 'volSlotOMes', 'currentCats', 'renderDet',
   'arbolDescendientesDet', 'iniRetPorRutaDet', 'filasDescendientesDet', 'volCatV2',
   'getConDescendienteConVolumen', 'esHojaPeriodo', 'conDeCatV2', 'conIniVolDe',
   'bindC1toggle', 'bindArbolToggle'].map(recortar).join('') +
  '\nreturn { modo: function (m) { modoTiempo = m; }, pintar: function () { renderDet(currentCats()); } };';
var tablero = (new Function('P', 'document', codigo))(P, document);

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}
function fila(nombre) { return cuerpo.filas.filter(function (f) { return f.nombre === nombre; })[0]; }
function clic(nombre) { fila(nombre).onclick({ target: { classList: { contains: function () { return false; } } } }); }
function visibles() {
  return cuerpo.filas.filter(function (f) { return f.classList.contains('c1row') || f.classList.contains('show'); })
    .map(function (f) { return f.nombre; });
}

tablero.pintar();
var n0 = cuerpo.filas.length;

// ---- J) jerarquia ----
Check('J1 orden de filas: C1, C2 y su subarbol por volumen',
  ['S-Equipo', '/S-Equipo/Aplicativo', 'Office', 'Word', 'Excel', 'Correo', '/S-Equipo/Hardware'],
  cuerpo.filas.map(function (f) { return f.nombre; }));
Check('J2 Aplicativo expandible', true, fila('/S-Equipo/Aplicativo').classList.contains('c2exp'));
Check('J3 Office (sin fila propia) expandible', true, fila('Office').classList.contains('c2exp'));
Check('J4 hijas directas de Aplicativo', ['Office', 'Correo'],
  cuerpo.filas.filter(function (f) { return f.dataset.p === fila('/S-Equipo/Aplicativo').dataset.g2; }).map(function (f) { return f.nombre; }));
Check('J5 hijas de Office', ['Word', 'Excel'],
  cuerpo.filas.filter(function (f) { return f.dataset.p === fila('Office').dataset.g2; }).map(function (f) { return f.nombre; }));
Check('J6 rama sin volumen ni iniciativa no se pinta', undefined, fila('Viejo'));

// ---- H) hojas ----
Check('H1 Hardware (C2 sin rutas debajo) no expandible', false, fila('/S-Equipo/Hardware').classList.contains('c2exp'));
Check('H2 Word / Excel / Correo no expandibles', [false, false, false],
  ['Word', 'Excel', 'Correo'].map(function (n) { return fila(n).classList.contains('c2exp'); }));

// ---- M) metricas: [anterior, actual, tendencia, con ini, %ini, riesgo, %tiempo, PO, SO] ----
Check('M1 C1 sin cambios', ['S-Equipo', '40', '60', '+', '10', '17%', '3', '67%', 'PO S-Equipo', 'SO S-Equipo'],
  fila('S-Equipo').tds.map(function (t, i) { return i === 0 ? fila('S-Equipo').nombre : t; }));
Check('M2 Aplicativo (C2) sin cambios', ['30', '50', '+', '10', '3', '67%', 'PO S-Equipo', 'SO S-Equipo'],
  [1, 2, 3, 4, 6, 7, 8, 9].map(function (i) { return fila('/S-Equipo/Aplicativo').tds[i]; }));
Check('M3 Office = Word + Excel; riesgo 0, en tiempo 100% (F2 activa a tiempo, F3 cerrada no cuenta)',
  ['Office', '20', '30', '+', '6', '20%', '0', '100%', 'PO Hoja', 'SO Hoja'], fila('Office').tds);
Check('M4 Correo: F1 retrasada', ['Correo', '8', '15', '+', '4', '27%', '3', '0%', 'PO Hoja', 'SO Hoja'], fila('Correo').tds);
Check('M5 Word: solo F3, cerrada: 0 riesgo, 100%', ['15', '20', '+', '0', '0', '100%'],
  [1, 2, 3, 4, 6, 7].map(function (i) { return fila('Word').tds[i]; }));
tablero.modo('mes'); tablero.pintar();
Check('M6 modo Mes: Office anterior / actual', ['40', '60'], [fila('Office').tds[1], fila('Office').tds[2]]);
tablero.modo('slot'); tablero.pintar();

// ---- T) toggles ----
Check('T1 al pintar solo se ven los C1', ['S-Equipo'], visibles());
clic('S-Equipo');
Check('T2 abrir C1: sus C2, sin nietos', ['S-Equipo', '/S-Equipo/Aplicativo', '/S-Equipo/Hardware'], visibles());
clic('/S-Equipo/Aplicativo');
Check('T3 abrir Aplicativo: solo hijas directas',
  ['S-Equipo', '/S-Equipo/Aplicativo', 'Office', 'Correo', '/S-Equipo/Hardware'], visibles());
clic('Office');
Check('T4 abrir Office: Word y Excel',
  ['S-Equipo', '/S-Equipo/Aplicativo', 'Office', 'Word', 'Excel', 'Correo', '/S-Equipo/Hardware'], visibles());
clic('/S-Equipo/Aplicativo');
Check('T5 cerrar Aplicativo oculta todo su subarbol', ['S-Equipo', '/S-Equipo/Aplicativo', '/S-Equipo/Hardware'], visibles());
Check('T6 y deja Office cerrado', false, fila('Office').classList.contains('open'));
clic('/S-Equipo/Aplicativo');
Check('T7 reabrir: otra vez solo hijas directas',
  ['S-Equipo', '/S-Equipo/Aplicativo', 'Office', 'Correo', '/S-Equipo/Hardware'], visibles());
for (var i = 0; i < 5; i++) { clic('Office'); clic('Office'); clic('/S-Equipo/Aplicativo'); clic('/S-Equipo/Aplicativo'); }
Check('T8 abrir / cerrar repetido no duplica filas', n0, cuerpo.filas.length);
clic('Office');
clic('S-Equipo');
Check('T9 cerrar C1 oculta todo', ['S-Equipo'], visibles());
Check('T10 y deja cerrados C2 y nietos', [false, false],
  [fila('/S-Equipo/Aplicativo').classList.contains('open'), fila('Office').classList.contains('open')]);
clic('S-Equipo');
Check('T11 reabrir C1: solo C2', ['S-Equipo', '/S-Equipo/Aplicativo', '/S-Equipo/Hardware'], visibles());

console.log(fallos ? fallos + ' FAIL' : 'TODO OK');
process.exit(fallos ? 1 : 0);
