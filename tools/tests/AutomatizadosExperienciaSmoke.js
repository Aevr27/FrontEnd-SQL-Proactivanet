// tools/tests/AutomatizadosExperienciaSmoke.js - serie "Automatizados SLA"
// de la Evolucion y tarjeta "Volumen sin Automatizar" de Experiencia.
//
// Automatizados SLA es TicketsAutomatizados de handlers/kpis.ashx (la tarjeta
// "Automatizado" de SLA), pedido por periodo de la grafica. La tarjeta es
// Volumen Actual - Automatizados SLA del mismo periodo. Lo que fija:
//
//   R)  rangos: los SLOTs 0..9 son los de dbo.vw_TicketsSlotsBase en la VM
//       el 2026-10-23 (SLOT 0 = 09-24..10-23 ... SLOT 9 = 2025-12-28..
//       2026-01-26), de 30 dias, sin hueco ni solape (ningun dia se cuenta
//       dos veces); un mes va del dia 1 al ultimo; lo invalido da null;
//   V)  valorAutomatizado: 0 es 0, sin dato es null;
//   G)  la linea de volumen no cambia con o sin barras; las barras van en
//       los mismos periodos y orden; el mes en curso lleva el pronostico;
//       sin dato queda hueco (null), cero queda cero; sin respuesta no hay
//       barras;
//   K)  tarjeta: 9000 - 1500 = 7500; automatizados en cero; cargando /
//       error / respaldo / sin dato (ninguno se toma como cero ni se resta);
//       negativo con su signo y aviso; Mes con el mes en curso y el mismo
//       pronostico que Volumen Actual;
//   M)  con un filtro de Director, PO, Manager, SO o tipo (o varios) no hay
//       barras, la leyenda dice "solo sin filtros" y la tarjeta queda en
//       N/D diciendo por que; sin filtros vuelven barras y resta; la linea
//       no cambia; "Ver por" no cuenta como filtro;
//   H)  la linea de volumen es la de HEAD; renderKPIs deja "Volumen Actual"
//       igual que HEAD y pone UNA tarjeta "Volumen sin Automatizar" justo
//       despues, sin la vieja "Tickets automatizados de SLA";
//   N)  peticiones: una por periodo, con fecha_inicio / fecha_fin; con el
//       corte guardado no se pide nada (respaldo); una falla deja la
//       tarjeta en error; se repinta solo si se sigue en el mismo modo.
//
// NO forma parte del sitio. Recorta las funciones del propio experiencia.js
// (patron de TipoRegistroExperienciaSmoke.js) y las corre con un DOM y una
// Chart de mentira.
//
// Como correrla (desde la raiz del repositorio):
//   node tools\tests\AutomatizadosExperienciaSmoke.js   # sale 0 si todo paso
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

// Funcion completa por llaves balanceadas (sirve tambien para las de una linea).
function recortar(src, nombre) {
  var ini = src.indexOf('\nfunction ' + nombre + '(');
  if (ini < 0) throw new Error(nombre + ' no esta en experiencia.js');
  var i = src.indexOf('{', ini), n = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') n++;
    else if (src[i] === '}' && --n === 0) break;
  }
  return src.slice(ini, i + 1) + '\n';
}
function bloque(src, a, b) {
  var i = src.indexOf(a), j = src.indexOf(b);
  if (i < 0 || j < 0) throw new Error('bloque ' + a + ' no esta en experiencia.js');
  return src.slice(i, j);
}

// ---- R / V) funciones puras --------------------------------------------
var puras = new Function(bloque(fuente, '/* === AUTOMATIZADOS SLA (inicio) === */', '/* === AUTOMATIZADOS SLA (fin) === */') +
  '\nreturn {rango: rangoAutomatizados, valor: valorAutomatizado};')();

var HOY = '2026-10-23';
Check('R1 SLOT 0 = hoy-29 .. hoy (acaba hoy)', { inicio: '2026-09-24', fin: '2026-10-23' },
  puras.rango('slot', 0, HOY));
Check('R2 SLOT 1 = hoy-59 .. hoy-30', { inicio: '2026-08-25', fin: '2026-09-23' }, puras.rango('slot', 1, HOY));
// MIN/MAX de FechaRegistro por Slot en dbo.vw_TicketsSlotsBase, VM, 2026-10-23.
var VM = [['2026-09-24', '2026-10-23'], ['2026-08-25', '2026-09-23'], ['2026-07-26', '2026-08-24'],
  ['2026-06-26', '2026-07-25'], ['2026-05-27', '2026-06-25'], ['2026-04-27', '2026-05-26'],
  ['2026-03-28', '2026-04-26'], ['2026-02-26', '2026-03-27'], ['2026-01-27', '2026-02-25'],
  ['2025-12-28', '2026-01-26']];
Check('R2 los diez SLOTs = los de la VM', VM,
  VM.map(function (_, k) { var r = puras.rango('slot', k, HOY); return [r.inicio, r.fin]; }));
Check('R3 acepta la fecha con hora', puras.rango('slot', 0, HOY), puras.rango('slot', 0, HOY + 'T10:00:00'));
function diaNum(iso) { var t = iso.split('-'); return Date.UTC(+t[0], +t[1] - 1, +t[2]) / 86400000; }
(function () {
  var contiguos = true, dias = 0, vistos = {};
  for (var k = 0; k <= 9; k++) {
    var r = puras.rango('slot', k, HOY);
    dias += diaNum(r.fin) - diaNum(r.inicio) + 1;
    for (var d = diaNum(r.inicio); d <= diaNum(r.fin); d++) {
      if (vistos[d]) contiguos = false;
      vistos[d] = true;
    }
    if (k > 0 && diaNum(r.fin) + 1 !== diaNum(puras.rango('slot', k - 1, HOY).inicio)) contiguos = false;
  }
  Check('R4 SLOTs 0..9 sin hueco ni solape (ningun dia dos veces)', true, contiguos);
  Check('R5 SLOTs 0..9 cubren 10 x 30 dias', 300, dias);
  Check('R5 cada SLOT mide 30 dias', [30, 30, 30, 30, 30, 30, 30, 30, 30, 30], VM.map(function (_, k) {
    var r = puras.rango('slot', k, HOY); return diaNum(r.fin) - diaNum(r.inicio) + 1; }));
  // SLOT 1 acaba el dia anterior al inicio del SLOT 0 (hoy-30), como en la VM.
  Check('R5 SLOT 1 acaba el dia antes de que empiece el SLOT 0', '2026-09-23', puras.rango('slot', 1, HOY).fin);
})();
Check('R6 mes: del 1 al ultimo dia', { inicio: '2026-10-01', fin: '2026-10-31' }, puras.rango('mes', 10, null, 2026));
Check('R7 febrero bisiesto', { inicio: '2028-02-01', fin: '2028-02-29' }, puras.rango('mes', 2, null, 2028));
Check('R8 diciembre', { inicio: '2026-12-01', fin: '2026-12-31' }, puras.rango('mes', 12, null, 2026));
Check('R9 invalidos dan null', [null, null, null, null, null],
  [puras.rango('mes', 0, null, 2026), puras.rango('mes', 13, null, 2026), puras.rango('mes', 5, null, undefined),
   puras.rango('slot', 0, undefined), puras.rango('slot', -1, HOY)]);

Check('V1 cero es cero', 0, puras.valor({ TicketsAutomatizados: 0 }));
Check('V2 numero', 57, puras.valor({ TicketsAutomatizados: 57 }));
Check('V3 sin dato es null (SLA pinta N/D)', [null, null, null, null],
  [puras.valor({ TicketsAutomatizados: null }), puras.valor({}), puras.valor(null), puras.valor({ TicketsAutomatizados: 'x' })]);

// ---- arnes de pintado ---------------------------------------------------
var PAYLOAD = {
  slot_nums: [0, 1, 2], mes_nums: [8, 9, 10], meses: ['Ago', 'Sep', 'Oct'],
  mes_actual: 10, dias_transcurridos_mes: 15, anio: 2026,
  meta: { periodoInicio: '2026-09-23', periodoFin: HOY },
  categorias: [
    { categoria: 'A', nivel: 'C1', vol_slot: { 0: 10, 1: 20, 2: 30 }, vol_mes: { 8: 40, 9: 50, 10: 30 },
      vol_actual: 9000, vol_actual_mes: 4500, iniciativas: [], ini_total: 0, ret: 0 },
  ],
};

function arnes(opciones) {
  opciones = opciones || {};
  var codigo =
    'var fDir="", fPO="", fMgr="", fSO="", tipoRegistro="todos";\n' +
    'var modoTiempo="slot", chartEvol=null, errApi=' + (opciones.errApi ? 'new Error("x")' : 'undefined') + ';\n' +
    'var VERDE={pino:"#p",profundo:"#d",lima:"#l"}, AMBAR_SEM="#a", CIFRAS_EXTREMOS={};\n' +
    'var document={getElementById:function(id){return ELEMENTOS[id]||(ELEMENTOS[id]={style:{},innerHTML:""});}};\n' +
    'function FMT(n){return String(Math.round(n||0));}\n' +
    'var KPIS_SLA_URL="http://x/handlers/kpis.ashx"; var REPINTADOS=[];\n' +
    'function aggCats(){return P.categorias;} function currentCats(){return P.categorias;}\n' +
    'function renderKPIs(){REPINTADOS.push("kpis:"+modoTiempo);}\n' +
    bloque(fuente, '/* === AUTOMATIZADOS SLA (inicio) === */', '/* === AUTOMATIZADOS SLA (fin) === */') +
    bloque(fuente, 'const automatizados = {};', '\nfunction periodosAutomatizados(').replace('const ', 'var ') +
    ['volSlotOMes', 'pronosticoMes', 'automatizadosDe', 'hayFiltrosAutomatizados', 'periodosAutomatizados', 'pedirAutomatizados',
     'tarjetaSinAutomatizar', 'volActualDe'].map(function (n) { return recortar(fuente, n); }).join('') +
    recortar(opciones.fuenteEvol || fuente, 'renderEvol') +
    // renderKPIs de verdad, con lo que no es de esta tarjeta de mentira.
    'var AGR=[], ESTADOS_ACTIVOS=[];\n' +
    'function PCT(n){return String(Math.round((n||0)*100))+"%";} function SEM(){return null;}\n' +
    'function volumenConIniciativa(){return 0;} function hojasSinIniciativa(){return [];} function volumenSinIniciativa(){return 0;}\n' +
    'function tarjetaEfectividad(){return {l:"Ef",v:"x",f:"",s:null};}\n' +
    recortar(fuente, 'renderKPIs').replace('function renderKPIs(', 'function renderKPIsReal(') +
    '\nvar renderEvolReal=renderEvol; renderEvol=function(c){REPINTADOS.push("evol:"+modoTiempo); renderEvolReal(c);};' +
    '\nreturn {' +
    ' modo: function (m) { modoTiempo = m; },' +
    ' filtrar: function (d, p, m, s, t) { fDir = d || ""; fPO = p || ""; fMgr = m || ""; fSO = s || ""; tipoRegistro = t || "todos"; },' +
    ' estado: function (m, e) { if (e === undefined) delete automatizados[m]; else automatizados[m] = e; },' +
    ' leer: function (m) { return automatizados[m]; },' +
    ' pedir: function (m) { pedirAutomatizados(m); },' +
    ' tarjeta: function (pron, vol) { return tarjetaSinAutomatizar(vol === undefined ? 100 : vol, pron); },' +
    ' kpis: function () { renderKPIsReal(P.categorias); return ELEMENTOS["kpis-exp"].innerHTML; },' +
    ' repintados: REPINTADOS,' +
    ' evol: function () { CHARTS.length = 0; renderEvolReal(P.categorias); return CHARTS[0]; } };';
  var CHARTS = [];
  function Chart(ctx, cfg) { CHARTS.push(cfg); this.destroy = function () {}; }
  var ELEMENTOS = {};
  var A = new Function('ELEMENTOS', 'P', 'Chart', 'CHARTS', 'traer', 'console', codigo)(
    ELEMENTOS, JSON.parse(JSON.stringify(PAYLOAD)), Chart, CHARTS, opciones.traer || function () {
      return Promise.reject(new Error('sin traer'));
    }, { warn: function () {} });
  A.elementos = ELEMENTOS;
  return A;
}

function sinFunciones(o) { return JSON.parse(JSON.stringify(o)); }

// ---- G) grafica ---------------------------------------------------------
var A = arnes();
var antes = A.evol();
Check('G1 sin respuesta: una sola serie (la de siempre)', 1, antes.data.datasets.length);
Check('G1 sin respuesta: eje x sin offset', false, antes.options.scales.x.offset);
Check('G1 linea SLOT antiguo -> reciente', [30, 20, 10], antes.data.datasets[0].data);

A.estado('slot', { estado: 'listo', valores: { 0: 3, 1: 0, 2: null } });
var con = A.evol();
Check('G2 con barras la linea es identica', sinFunciones(antes.data.datasets[0]), sinFunciones(con.data.datasets[0]));
Check('G2 etiquetas identicas', antes.data.labels, con.data.labels);
Check('G3 barras en los mismos SLOTs y orden; cero es cero, sin dato es hueco', [null, 0, 3], con.data.datasets[1].data);
Check('G3 serie de barras por detras de la linea', ['bar', 1], [con.data.datasets[1].type, con.data.datasets[1].order]);
Check('G4 tooltip linea sin cambio', 'Volumen: 20',
  con.options.plugins.tooltip.callbacks.label({ datasetIndex: 0, dataIndex: 1, raw: 20 }));
Check('G4 tooltip barra / hueco', ['Automatizados SLA: 0', 'Automatizados SLA: sin dato'],
  [con.options.plugins.tooltip.callbacks.label({ datasetIndex: 1, dataIndex: 1, raw: 0 }),
   con.options.plugins.tooltip.callbacks.label({ datasetIndex: 1, dataIndex: 0, raw: null })]);
Check('G5 leyenda con las dos series', true,
  /Volumen total[\s\S]*Automatizados SLA/.test(A.elementos.legendEvol.innerHTML));
Check('G5 el HTML trae el contenedor de la leyenda', true, html.indexOf('id="legendEvol"') >= 0);

A.modo('mes');
var mesAntes = A.evol();
A.estado('mes', { estado: 'listo', valores: { 8: 12, 9: 0, 10: 6 } });
var mes = A.evol();
Check('G6 Mes: linea identica con y sin barras', sinFunciones(mesAntes.data.datasets[0]), sinFunciones(mes.data.datasets[0]));
Check('G6 Mes: mes en curso con pronostico (6 / 15 x 30 = 12)', [12, 0, 12], mes.data.datasets[1].data);
Check('G6 Mes: tooltip del pronostico dice el real', 'Automatizados SLA · Pronóstico: 12 · Real a la fecha: 6',
  mes.options.plugins.tooltip.callbacks.label({ datasetIndex: 1, dataIndex: 2, raw: 12 }));
A.estado('mes', { estado: 'error', valores: {} });
Check('G7 error: sin barras y la leyenda lo dice', [1, true],
  [A.evol().data.datasets.length, /error al consultar SLA/.test(A.elementos.legendEvol.innerHTML)]);
A.estado('mes', { estado: 'respaldo', valores: {} });
Check('G8 respaldo: sin barras y la leyenda lo dice (no como error)', [1, true, false],
  [A.evol().data.datasets.length, /respaldo: SLA no disponible/.test(A.elementos.legendEvol.innerHTML),
   /error/.test(A.elementos.legendEvol.innerHTML)]);

// ---- M) filtros ---------------------------------------------------------
var M = arnes();
var mBase = M.evol();
M.estado('slot', { estado: 'listo', valores: { 0: 3, 1: 0, 2: 5 } });
function conFiltro(d, p, m, s, t) {
  M.filtrar(d, p, m, s, t);
  var g = M.evol();
  return { series: g.data.datasets.length, linea: sinFunciones(g.data.datasets[0]), offset: g.options.scales.x.offset,
    leyenda: M.elementos.legendEvol.innerHTML, tarjeta: M.tarjeta(false, 9000) };
}
var libre = conFiltro();
Check('M0 sin filtros: barras', 2, libre.series);
var SOLO = 'Automatizados SLA: solo sin filtros (valor global)';
var SIN_FILTROS = 'No disponible con filtros: Automatizados SLA es global y no responde a los filtros activos';
Check('M0 sin filtros: resta (9000 - 3)', '8997', libre.tarjeta.v);
[['M1 Director', ['Dir A']], ['M1 PO', ['', 'PO X']], ['M1 Manager', ['', '', 'Mgr']],
 ['M1 SO', ['', '', '', 'SO X']], ['M1 tipo Incidentes', ['', '', '', '', 'inc']],
 ['M1 tipo Requerimientos', ['', '', '', '', 'req']]].forEach(function (c) {
  var r = conFiltro.apply(null, c[1]);
  Check(c[0] + ' oculta las barras y la leyenda lo dice', [1, true, false], [r.series, r.leyenda.indexOf(SOLO) >= 0, r.offset]);
  Check(c[0] + ': la linea es identica', sinFunciones(mBase.data.datasets[0]), r.linea);
  Check(c[0] + ': KPI visible en N/D, no resta el global del filtrado', ['Volumen sin Automatizar', 'N/D', SIN_FILTROS],
    [r.tarjeta.l, r.tarjeta.v, r.tarjeta.f]);
});
var varios = conFiltro('Dir A', 'PO X', 'Mgr', 'SO X', 'inc');
Check('M2 varios filtros a la vez: sin barras ni resta', [1, true, 'N/D'],
  [varios.series, varios.leyenda.indexOf(SOLO) >= 0, varios.tarjeta.v]);
var vuelta = conFiltro();
Check('M3 quitar los filtros restaura barras y leyenda', [2, false, true],
  [vuelta.series, vuelta.leyenda.indexOf(SOLO) >= 0, /Automatizados SLA \(resueltos, global\)/.test(vuelta.leyenda)]);
Check('M3 la vuelta pinta lo mismo que antes de filtrar', sinFunciones(libre), sinFunciones(vuelta));
Check('M3 quitar los filtros restaura la resta', ['8997', true], [vuelta.tarjeta.v, /9000 − 3 Automatizados SLA/.test(vuelta.tarjeta.f)]);
M.modo('mes');
M.estado('mes', { estado: 'listo', valores: { 8: 1, 9: 2, 10: 3 } });
Check('M4 "Ver por" Mes no cuenta como filtro: hay barras', 2, conFiltro().series);
M.modo('slot');
M.estado('slot', { estado: 'listo', valores: { 0: 0 } });
Check('M5 con filtro tampoco resta un cero', ['N/D', SIN_FILTROS], [conFiltro('Dir A').tarjeta.v, conFiltro('Dir A').tarjeta.f]);
Check('M5 sin filtro, automatizados en cero: el volumen tal cual', '9000', conFiltro().tarjeta.v);

// ---- K) tarjeta ---------------------------------------------------------
var K = arnes();
var AVISO = 'Aprox.: resueltos por bot en el periodo, no subconjunto del volumen.';
Check('K1 sin pedir / cargando: no resta', ['…', '…'], [K.tarjeta(false, 9000).v,
  (K.estado('slot', { estado: 'cargando', valores: {} }), K.tarjeta(false, 9000).v)]);
K.estado('slot', { estado: 'error', valores: {} });
Check('K2 error: dice el error, no resta ni da N/D', ['—', 'Error al consultar SLA'],
  [K.tarjeta(false, 9000).v, K.tarjeta(false, 9000).f]);
K.estado('slot', { estado: 'respaldo', valores: {} });
Check('K2 respaldo: distinto del error, no resta', ['—', 'Respaldo: SLA no disponible'],
  [K.tarjeta(false, 9000).v, K.tarjeta(false, 9000).f]);
K.estado('slot', { estado: 'listo', valores: { 0: null } });
Check('K3 automatizados sin dato = N/D, no resta', ['N/D', 'SLA sin dato en el periodo'],
  [K.tarjeta(false, 9000).v, K.tarjeta(false, 9000).f]);
K.estado('slot', { estado: 'listo', valores: { 0: 0 } });
Check('K4 automatizados en cero: 9000 - 0 = 9000', '9000', K.tarjeta(false, 9000).v);
K.estado('slot', { estado: 'listo', valores: { 0: 1500, 1: 99 } });
var k5 = K.tarjeta(false, 9000);
Check('K5 9000 - 1500 = 7500 con el SLOT 0', ['Volumen sin Automatizar', '7500'], [k5.l, k5.v]);
Check('K5 el pie da los dos terminos y que es aproximado', [true, true],
  [/9000 − 1500 Automatizados SLA/.test(k5.f),
   k5.f.slice(-AVISO.length) === AVISO]);
Check('K5 el aviso va tambien en negativo y con cero automatizados', [true, true],
  [K.tarjeta(false, 0).f.indexOf(AVISO) >= 0, (K.estado('slot', { estado: 'listo', valores: { 0: 0 } }),
    K.tarjeta(false, 9000).f.indexOf(AVISO) >= 0)]);
K.estado('slot', { estado: 'listo', valores: { 0: 1500, 1: 99 } });
Check('K5 volumen en cero tambien resta', '-1500', K.tarjeta(false, 0).v);
var kn = K.tarjeta(false, 1000);
Check('K7 negativo: con signo, sin recortar a cero, y avisado', ['-500', true],
  [kn.v, /^Negativo: los valores pueden no ser directamente comparables · /.test(kn.f)]);
K.modo('mes');
K.estado('mes', { estado: 'listo', valores: { 9: 7000, 10: 750 } });
// dias_transcurridos_mes = 15: pronostico(4500) = 9000, pronostico(750) = 1500.
var kp = K.tarjeta(true, 4500);
Check('K6 Mes: mes en curso, los dos con el pronostico de Volumen Actual', ['7500', true, true, true],
  [kp.v, /9000 − 1500 Automatizados SLA/.test(kp.f), /Real a la fecha: 3750/.test(kp.f), /Pronóstico/.test(kp.l)]);
Check('K6 Mes: con el aviso', true, kp.f.indexOf(AVISO) >= 0);
Check('K6 Mes sin pronostico: los reales del mes en curso (no del mes 9)', '3750', K.tarjeta(false, 4500).v);

// ---- H) Volumen Actual, la linea y la tarjeta en renderKPIs ---------------
(function () {
  var head;
  try {
    head = limpiar(cp.execSync('git show HEAD:experiencia/experiencia.js',
      { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (err) { console.log('SKIP  H sin git: no se compara contra HEAD'); return; }
  ['slot', 'mes'].forEach(function (m) {
    var a = arnes(), h = arnes({ fuenteEvol: head });
    var valores = m === 'mes' ? { 8: 1, 9: 2, 10: 3 } : { 0: 1, 1: 2, 2: 3 };
    a.modo(m); h.modo(m);
    a.estado(m, { estado: 'listo', valores: valores });
    Check('H1 ' + m + ': linea identica a la de HEAD con las barras puestas',
      sinFunciones(h.evol().data.datasets[0]), sinFunciones(a.evol().data.datasets[0]));
  });
  var kh = recortar(head, 'renderKPIs'), kw = recortar(fuente, 'renderKPIs');
  Check('H2 renderKPIs = HEAD salvo la tarjeta nueva (Volumen Actual sin cambios)',
    kh, kw.replace('    tarjetaSinAutomatizar(vol, esPron),\n', ''));
})();
var KP = arnes();
KP.estado('slot', { estado: 'listo', valores: { 0: 1500 } });
var html1 = KP.kpis();
var rotulos = (html1.match(/<div class="lbl">[^<]*/g) || []).map(function (x) { return x.replace('<div class="lbl">', ''); });
Check('H3 Volumen Actual primero y Volumen sin Automatizar justo despues', ['Volumen Actual (0-30d)', 'Volumen sin Automatizar'],
  rotulos.slice(0, 2));
Check('H3 una sola tarjeta nueva y sin la de conteo', [1, false, false],
  [rotulos.filter(function (r) { return r === 'Volumen sin Automatizar'; }).length,
   /Tickets automatizados de SLA/.test(html1), /tarjetaAutomatizados|Tickets automatizados de SLA/.test(fuente)]);
var vals = (html1.match(/<div class="val">[^<]*/g) || []).map(function (x) { return x.replace('<div class="val">', ''); });
Check('H4 por renderKPIs: Volumen Actual 9000 y sin Automatizar 7500', ['9000', '7500'], vals.slice(0, 2));

// ---- N) peticiones ------------------------------------------------------
(async function () {
  var urls = [];
  var N = arnes({ traer: function (u) {
    urls.push(u);
    var q = new URL(u).searchParams;
    return Promise.resolve({ TicketsAutomatizados: q.get('fecha_fin') === HOY ? 5 : 0 });
  } });
  N.pedir('slot');
  Check('N1 queda cargando', 'cargando', N.leer('slot').estado);
  N.pedir('slot');
  await new Promise(function (r) { setTimeout(r, 0); });
  Check('N2 una peticion por SLOT, aunque se llame dos veces', 3, urls.length);
  Check('N2 al handler de KPIs de SLA con el rango del SLOT', [
    'http://x/handlers/kpis.ashx?fecha_inicio=2026-09-24&fecha_fin=2026-10-23',
    'http://x/handlers/kpis.ashx?fecha_inicio=2026-08-25&fecha_fin=2026-09-23',
    'http://x/handlers/kpis.ashx?fecha_inicio=2026-07-26&fecha_fin=2026-08-24'], urls);
  Check('N3 valores por SLOT', { estado: 'listo', valores: { 0: 5, 1: 0, 2: 0 } }, N.leer('slot'));
  Check('N4 repinta tarjeta y grafica del modo', ['kpis:slot', 'evol:slot'], N.repintados.slice());

  urls.length = 0;
  N.repintados.length = 0;
  N.pedir('mes');
  N.modo('slot');   // el usuario vuelve a SLOT antes de que llegue la respuesta
  await new Promise(function (r) { setTimeout(r, 0); });
  Check('N5 Mes: un mes por peticion', ['2026-08-01|2026-08-31', '2026-09-01|2026-09-30', '2026-10-01|2026-10-31'],
    urls.map(function (u) { var q = new URL(u).searchParams; return q.get('fecha_inicio') + '|' + q.get('fecha_fin'); }));
  Check('N6 no repinta si ya se cambio de modo', [], N.repintados.slice());

  var R = arnes({ errApi: true, traer: function () { throw new Error('no deberia pedir'); } });
  R.pedir('slot');
  Check('N7 corte guardado: no pide y queda en respaldo', ['respaldo', 'Respaldo: SLA no disponible'],
    [R.leer('slot').estado, R.tarjeta(false).f]);

  var F = arnes({ traer: function () { return Promise.reject(new Error('HTTP 500')); } });
  F.pedir('slot');
  await new Promise(function (r) { setTimeout(r, 0); });
  Check('N8 falla del handler: error, no cero ni N/D', ['error', '—', 'Error al consultar SLA'],
    [F.leer('slot').estado, F.tarjeta(false).v, F.tarjeta(false).f]);
  var J = arnes({ traer: function () { return Promise.reject(new SyntaxError('Unexpected token <')); } });
  J.pedir('slot');
  await new Promise(function (r) { setTimeout(r, 0); });
  Check('N9 respuesta que no es JSON: error, no cero', ['error', '—'], [J.leer('slot').estado, J.tarjeta(false).v]);

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo paso');
  process.exit(fallos ? 1 : 0);
})();
