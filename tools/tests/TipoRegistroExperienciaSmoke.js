// tools/tests/TipoRegistroExperienciaSmoke.js - selector Todos / Incidentes /
// Requerimientos de Experiencia.
//
// El payload trae por categoria vol_slot / vol_mes (Todos: [Total general]
// de vw_TBSlotCAT / vw_TBMesCAT) y vol_tipo.inc / .req (columnas
// [Incidencia] y [Petición de Servicio]). aplicarTipoRegistro sustituye los
// campos de volumen por los del tipo elegido. Lo que fija:
//
//   I)  la vista inicial es Todos (estado y boton del HTML);
//   T)  Todos incluye Incidentes, Requerimientos y el resto (SorIA, otros);
//   N)  Incidentes / Requerimientos excluyen todo lo demas;
//   V)  cambiar de tipo cambia tarjeta de volumen, evolucion, detalle,
//       Con / Sin Iniciativa y volumen de folio;
//   F)  los filtros de Director / PO / Manager / SO se combinan con el tipo
//       y no se reinician al cambiarlo; "Ver por" Mes tambien;
//   D)  sin duplicados: KPI-2 + KPI-5 = volumen de las hojas, y las sumas
//       C1 = sus C2;
//   E)  un tipo sin registros pinta vacio sin fallar;
//   P)  volver a Todos deja el payload igual que llego (nada persistido ni
//       ajeno al volumen cambia), y Todos pinta lo mismo que HEAD;
//   S)  sin vol_tipo (mock o handler anterior) el selector no se ofrece.
//
// NO forma parte del sitio. Recorta las funciones del propio experiencia.js
// (patron de ResumenSubnivelExperienciaSmoke.js) y las corre con un DOM y
// una Chart de mentira. La comparacion con HEAD usa `git show`; si git no
// esta, ese bloque se salta y lo dice.
//
// Como correrla (desde la raiz del repositorio):
//   node tools\tests\TipoRegistroExperienciaSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var raiz = path.join(__dirname, '..', '..');
function limpiar(s) { return s.split(String.fromCharCode(13)).join(''); }
var fuente = limpiar(fs.readFileSync(path.join(raiz, 'experiencia', 'experiencia.js'), 'utf8'));
var html = limpiar(fs.readFileSync(path.join(raiz, 'experiencia', 'experiencia.html'), 'utf8'));

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var ok = JSON.stringify(esperado) === JSON.stringify(obtenido);
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + JSON.stringify(esperado) +
    '  obtenido=' + JSON.stringify(obtenido)));
}

function recortar(src, nombre) {
  var ini = src.indexOf('\nfunction ' + nombre + '(');
  if (ini < 0) throw new Error(nombre + ' no esta en experiencia.js');
  var fin = src.indexOf('\n}\n', ini);
  return src.slice(ini, fin + 3);
}

// ---- payload con la forma de ExperienciaQueries -----------------------
// Series por periodo: {todos, inc, req} x {slot, mes}. El resto (SorIA,
// otros) es todos - inc - req y SOLO aparece en Todos.
var MES = 10;
function campos(c, s) {
  c.vol_slot = s.todos.slot; c.vol_mes = s.todos.mes;
  c.vol_tipo = { inc: s.inc, req: s.req };
  return c;
}
function cat(nivel, c1, categoria, s, dir, po) {
  var c = campos({ nivel: nivel, c1: c1, categoria: categoria, director: dir, po: po, so: 'SO ' + po,
    manager: 'Mgr ' + po, ini: { Problem: 0 }, ini_total: 0, pct_inic: 0, ret: 0, pct_en_tiempo: 1,
    iniciativas: [], inc: 0, pet: 0, reqopr: 0 }, s);
  c.vol_actual = s.todos.slot['0'] || 0; c.vol_anterior = s.todos.slot['1'] || 0;
  c.delta = c.vol_actual - c.vol_anterior;
  c.vol_actual_mes = s.todos.mes[String(MES)] || 0; c.vol_anterior_mes = s.todos.mes[String(MES - 1)] || 0;
  c.delta_mes = c.vol_actual_mes - c.vol_anterior_mes;
  return c;
}
function v2(categoria, s, reduce, dir, po) {
  return campos({ categoria: categoria, es_hoja: true, tiene_iniciativa: reduce > 0, ticket_reduce: reduce,
    director: dir, po: po, so: 'SO ' + po, manager: 'Mgr ' + po }, s);
}
function S(t0, t1, tm, i0, i1, im, r0, r1, rm) {
  function m(a, b) { var o = {}; if (a) o['0'] = a; if (b) o['1'] = b; return o; }
  function mm(a) { var o = {}; if (a) o[String(MES)] = a; return o; }
  return { todos: { slot: m(t0, t1), mes: mm(tm) }, inc: { slot: m(i0, i1), mes: mm(im) },
           req: { slot: m(r0, r1), mes: mm(rm) } };
}
// slot 0:              Todos  Inc  Req  resto
//   /Red/LAN/Switch      10     6    3    1
//   /Red/WAN              5     0    5    0
//   /Sorx/Bot             3     0    0    3   (solo SorIA)
//   total                18     6    8    4
var sSwitch = S(10, 8, 9, 6, 4, 7, 3, 2, 1);
var sWan = S(5, 2, 4, 0, 0, 0, 5, 2, 4);
var sBot = S(3, 0, 3, 0, 0, 0, 0, 0, 0);
var sLan = sSwitch;
var sRed = S(15, 10, 13, 6, 4, 7, 8, 4, 5);
var PAYLOAD = {
  mes_actual: MES, dias_transcurridos_mes: 0,
  slot_nums: [0, 1], mes_nums: [MES - 1, MES], meses: ['Sep', 'Oct'],
  agrupadores: ['Problem'],
  categorias: [
    cat('C1', 'Red', 'Red', sRed, 'Dir A', 'PO Red'),
    cat('C2', 'Red', '/Red/LAN', sLan, 'Dir A', 'PO Red'),
    cat('C2', 'Red', '/Red/WAN', sWan, 'Dir A', 'PO Red'),
    cat('C1', 'Sorx', 'Sorx', sBot, 'Dir B', 'PO Bot'),
    cat('C2', 'Sorx', '/Sorx/Bot', sBot, 'Dir B', 'PO Bot'),
  ],
  categorias_v2: [
    v2('/Red/LAN/Switch', sSwitch, 4, 'Dir A', 'PO Red'),
    v2('/Red/WAN', sWan, 0, 'Dir A', 'PO Red'),
    v2('/Sorx/Bot', sBot, 0, 'Dir B', 'PO Bot'),
  ],
  categorias_por_folio: { P1: [{ categoria: '/Red/LAN/Switch', tickets_reduce: 4 }] },
};

// ---- arnes ------------------------------------------------------------
var COMUNES = ['pasaFiltroGlobal', 'volActualDe', 'volAnteriorDe', 'deltaDe', 'volSlotOMes', 'pronosticoMes',
  'currentCats', 'aggCats', 'renderKPIs', 'efectividadDe', 'tarjetaEfectividad', 'tarjetaSinAutomatizar', 'renderEvol', 'renderDet',
  'volCatV2', 'getConDescendienteConVolumen', 'esHojaPeriodo', 'conDeCatV2', 'sinDeCatV2',
  'hojasSinIniciativa', 'volumenSinIniciativa', 'volumenConIniciativa', 'conIniVolDe', 'renderSin',
  'catV2ByPath', 'categoriasDeFolio', 'volumenCategoriasFolio'];

function arnes(src, payload, conTipos) {
  var codigo =
    'var fDir="", fPO="", fMgr="", fSO="", modoTiempo="slot", chartEvol=null;\n' +
    'var _cacheHojaPeriodo={modo:null, tipo:null, set:null};\n' +
    'var AGR=P.agrupadores, ESTADOS_ACTIVOS=["En Análisis","En Solución","En Monitoreo"];\n' +
    'var VERDE={pino:"",profundo:""}, AMBAR_SEM="", CIFRAS_EXTREMOS={}, CIFRAS_ENCIMA_BARRAS={}, ACOLOR={}, NEUTRO_SEM="";\n' +
    // Sin respuesta de kpis.ashx: la grafica y las tarjetas de antes.
    'function automatizadosDe(){return null;} function hayFiltrosAutomatizados(){return false;}\n' +
    'var AYUDA_SIN_AUTOMATIZAR="", Escape={attr:function(s){return String(s);}}, Paleta={AZUL_SERIE:"#2563eb"};\n' +
    'var document={getElementById:function(id){return ELEMENTOS[id]||(ELEMENTOS[id]={style:{},classList:{add:function(){},remove:function(){}}});}};\n' +
    'function FMT(n){return String(Math.round(n||0));} function PCT(n){return String(Math.round((n||0)*100))+"%";}\n' +
    'function SEM(){return "v";} function esc(s){return String(s);} function fdate(){return "";}\n' +
    'function tend(){return "";} function miniBar(){return "";} function badge(){return "";} function badgeBin(){return "";}\n' +
    'function bindC1toggle(){} function bindC2toggle(){} function bindCatClicks(){}\n' +
    (conTipos ? src.slice(src.indexOf('let tipoRegistro='), src.indexOf('\nfunction camposVolumenTipo(')) +
      recortar(src, 'camposVolumenTipo') + recortar(src, 'aplicarTipoRegistro') : '') +
    COMUNES.map(function (n) { return recortar(src, n); }).join('') +
    '\nreturn {' +
    ' tipo: function (t) { aplicarTipoRegistro(t); },' +
    ' estado: function () { return tipoRegistro; },' +
    ' hayTipos: function () { return HAY_TIPOS; },' +
    ' filtrar: function (d, p, m, s) { fDir = d || ""; fPO = p || ""; fMgr = m || ""; fSO = s || ""; },' +
    ' filtros: function () { return [fDir, fPO, fMgr, fSO, modoTiempo]; },' +
    ' modo: function (m) { modoTiempo = m; },' +
    ' pintar: function () {' +
    '   var agg = aggCats(), cats = currentCats(); CHARTS.length = 0;' +
    '   renderKPIs(agg, cats); renderEvol(agg); renderDet(cats); renderSin(cats);' +
    '   return { kpis: ELEMENTOS["kpis-exp"].innerHTML, evol: CHARTS[0].data.datasets[0].data.slice(),' +
    '     det: ELEMENTOS.bodyDet.innerHTML, sin: ELEMENTOS.bodySin.innerHTML,' +
    '     tarjeta: agg.reduce(function (s, c) { return s + volActualDe(c); }, 0),' +
    '     con: volumenConIniciativa(), sinIni: volumenSinIniciativa(),' +
    '     hojas: P.categorias_v2.filter(esHojaPeriodo).reduce(function (s, c) { return s + volCatV2(c); }, 0),' +
    '     folio: volumenCategoriasFolio("P1") }; } };';
  var CHARTS = [];
  function Chart(ctx, cfg) { CHARTS.push(cfg); this.destroy = function () {}; }
  return new Function('ELEMENTOS', 'P', 'Chart', 'CHARTS', codigo)({}, payload, Chart, CHARTS);
}

function copia(o) { return JSON.parse(JSON.stringify(o)); }
// La tarjeta de volumen es la primera .val del bloque de KPIs.
function primerVal(kpis) { var m = /<div class="val">([^<]*)<\/div>/.exec(kpis); return m ? m[1] : null; }

var payload = copia(PAYLOAD);
var original = copia(PAYLOAD);
var A = arnes(fuente, payload, true);

// ---- I) vista inicial ----
Check('I1 estado inicial Todos', 'todos', A.estado());
var mBotones = html.match(/<button type="button" data-tipo="[a-z]+" aria-pressed="(true|false)"[^>]*>[^<]*<\/button>/g) || [];
Check('I2 tres botones en el HTML, en orden', ['Todos', 'Incidentes', 'Requerimientos'],
  mBotones.map(function (b) { return />([^<]*)<\/button>$/.exec(b)[1]; }));
Check('I3 solo Todos marcado en el HTML', ['true', 'false', 'false'],
  mBotones.map(function (b) { return /aria-pressed="(\w+)"/.exec(b)[1]; }));
Check('S1 con vol_tipo se ofrece el selector', true, A.hayTipos());

// ---- T / N) totales por tipo ----
var todos = A.pintar();
Check('T1 Todos: tarjeta = Inc + Req + resto (6 + 8 + 4)', 18, todos.tarjeta);
Check('T2 Todos: evolucion SLOT (antiguo -> reciente)', [10, 18], todos.evol);
A.tipo('inc');
var inc = A.pintar();
Check('N1 Incidentes: tarjeta solo [Incidencia]', 6, inc.tarjeta);
Check('N1 Incidentes: evolucion', [4, 6], inc.evol);
Check('N1 Incidentes: valor de la tarjeta pintada', '6', primerVal(inc.kpis));
A.tipo('req');
var req = A.pintar();
Check('N2 Requerimientos: tarjeta solo [Peticion de Servicio]', 8, req.tarjeta);
Check('N2 Requerimientos: evolucion', [4, 8], req.evol);
Check('N3 ni Incidentes ni Requerimientos cubren el resto', 4, todos.tarjeta - inc.tarjeta - req.tarjeta);
Check('N4 /Sorx/Bot (solo SorIA) desaparece fuera de Todos', [true, false, false],
  [todos.det.indexOf('/Sorx/Bot') >= 0, inc.det.indexOf('/Sorx/Bot') >= 0, req.det.indexOf('/Sorx/Bot') >= 0]);

// ---- V) todas las visualizaciones cambian ----
Check('V1 detalle distinto por tipo', [true, true], [todos.det !== inc.det, inc.det !== req.det]);
Check('V2 Con / Sin Iniciativa (Switch: reduce 4)', [[4, 14], [4, 2], [3, 5]],
  [[todos.con, todos.sinIni], [inc.con, inc.sinIni], [req.con, req.sinIni]]);
Check('V3 volumen de las categorias del folio P1', [10, 6, 3], [todos.folio, inc.folio, req.folio]);
Check('V4 tabla Sin iniciativa cambia', true, todos.sin !== req.sin);

// ---- D) sin duplicados ----
Check('D1 KPI-2 + KPI-5 = volumen de hojas, en los tres tipos', [true, true, true],
  [todos, inc, req].map(function (x) { return x.con + x.sinIni === x.hojas; }));
Check('D2 hojas = tarjeta (sin padres con volumen propio)', [18, 6, 8], [todos.hojas, inc.hojas, req.hojas]);

// ---- F) filtros combinados ----
A.filtrar('Dir A');
A.tipo('inc');
var f1 = A.pintar();
Check('F1 Director A + Incidentes', 6, f1.tarjeta);
A.tipo('req');
Check('F2 cambiar tipo no reinicia Director', ['Dir A', '', '', '', 'slot'], A.filtros());
Check('F3 Director A + Requerimientos', 8, A.pintar().tarjeta);
A.filtrar('Dir B');
Check('F4 Director B (solo SorIA) + Requerimientos = 0', 0, A.pintar().tarjeta);
A.tipo('todos');
Check('F5 Director B + Todos = 3', 3, A.pintar().tarjeta);
A.filtrar('');
A.modo('mes');
A.tipo('req');
var mes = A.pintar();
Check('F6 Mes + Requerimientos: actual (Switch 1 + WAN 4)', 5, mes.tarjeta);
Check('F6 Mes + Requerimientos: evolucion [Sep, Oct]', [0, 5], mes.evol);
A.tipo('inc');
Check('F7 Mes + Incidentes', 7, A.pintar().tarjeta);
A.modo('slot');

// ---- E) seleccion sin resultados ----
var vacio = copia(PAYLOAD);
vacio.categorias.concat(vacio.categorias_v2).forEach(function (c) { c.vol_tipo.req = { slot: {}, mes: {} }; });
var B = arnes(fuente, vacio, true);
B.tipo('req');
var e;
try { e = B.pintar(); } catch (err) { e = { error: String(err) }; }
Check('E1 Requerimientos sin registros no falla', undefined, e.error);
Check('E2 tarjeta 0 y evolucion en 0', [0, [0, 0]], [e.tarjeta, e.evol]);
Check('E3 detalle con estado vacio', true, /Sin datos/.test(e.det));
var sinSeries = copia(PAYLOAD);
sinSeries.categorias_v2[0].vol_tipo = {};   // tipo ausente en una fila: cuenta 0, no revienta
var B2 = arnes(fuente, sinSeries, true);
B2.tipo('inc');
try { e = B2.pintar(); } catch (err) { e = { error: String(err) }; }
Check('E4 una fila sin la serie del tipo no falla', undefined, e.error);

// ---- P) volver a Todos ----
A.filtrar('');
A.tipo('todos');
var vuelta = A.pintar();
Check('P1 Todos tras ir y volver pinta igual', [todos.kpis, todos.evol, todos.det, todos.sin],
  [vuelta.kpis, vuelta.evol, vuelta.det, vuelta.sin]);
function sinTodos(o) {
  var c = copia(o);
  c.categorias.concat(c.categorias_v2).forEach(function (x) { delete x._todos; });
  return c;
}
Check('P2 el payload queda como llego (salvo el respaldo _todos)', original, sinTodos(payload));
A.tipo('xyz');
Check('P3 un tipo desconocido cae a Todos', 'todos', A.estado());

// Todos pinta lo mismo que el experiencia.js de HEAD, con el mismo payload.
var head = null;
try {
  head = limpiar(cp.execSync('git show HEAD:experiencia/experiencia.js',
    { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 1 << 26 }));
} catch (err) { console.log('SKIP  P4 sin git: no se compara contra HEAD'); }
if (head && head.indexOf('let tipoRegistro=') < 0) {
  var H = arnes(head, copia(PAYLOAD), false);
  var h = H.pintar();
  Check('P4 Todos = HEAD (KPIs, evolucion, detalle, sin iniciativa)', [h.kpis, h.evol, h.det, h.sin],
    [todos.kpis, todos.evol, todos.det, todos.sin]);
} else if (head) {
  console.log('SKIP  P4 HEAD ya trae el selector: no hay linea base anterior');
}

// ---- S) sin vol_tipo ----
var viejo = copia(PAYLOAD);
viejo.categorias.concat(viejo.categorias_v2).forEach(function (c) { delete c.vol_tipo; });
Check('S2 sin vol_tipo no se ofrece el selector', false, arnes(fuente, viejo, true).hayTipos());

console.log(fallos ? fallos + ' FAIL' : 'TODO OK');
process.exit(fallos ? 1 : 0);
