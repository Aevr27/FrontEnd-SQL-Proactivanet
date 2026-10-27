// tools/tests/AutomatizadosExperienciaSmoke.js - serie "Automatizados SLA"
// de la Evolucion y tarjeta "Volumen - Automatizado" de Experiencia.
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
//   M)  con un filtro de Director, PO, Manager o SO (o varios, con o sin
//       tipo) no hay barras, la leyenda dice "solo sin filtros" y la tarjeta
//       queda en N/D diciendo por que; sin filtros vuelven barras y resta;
//       la linea no cambia; "Ver por" y el tipo de registro no cuentan como
//       filtro;
//   T)  tipo de registro: Incidentes / Requerimientos piden ?tipo=inc|req y
//       la tarjeta resta el volumen de ese tipo menos los automatizados de
//       ese tipo (6000 - 1000, 2500 - 0, Mes con pronostico); Todos da
//       EXACTAMENTE lo de ANTES_TIPO (tarjeta, grafica, URLs, demas
//       tarjetas); Todos -> Inc -> Req -> Todos; sin datos = N/D de "sin
//       dato", cero = cero; error / sin respuesta / respuesta tardia de
//       otro tipo no pasan por resultado; los filtros de dueño y "Ver por"
//       se conservan;
//   H)  la linea de volumen es la de BASE (fc83739, el commit anterior a esta
//       tarjeta); renderKPIs deja "Volumen Actual" igual que BASE y pone
//       UNA tarjeta "Volumen - Automatizado" justo
//       despues, sin la vieja "Tickets automatizados de SLA" ni el rotulo
//       anterior "Volumen sin Automatizar";
//   C)  cifra encima de cada barra Automatizados SLA: FMT con miles, 0 si,
//       null no; si no cabe arriba (borde o linea) va dentro, y si tampoco,
//       se omite; la linea no lleva cifras de este plugin;
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
var FUENTE = fuente;   // la de arnes() si no se le pasa otra

// La Paleta real del tablero (assets/js/paleta.js), como la carga la pagina.
var PALETA = (function () {
  var ventana = {};
  (new Function('window', fs.readFileSync(path.join(raiz, 'assets', 'js', 'paleta.js'), 'utf8')))(ventana);
  return ventana.Paleta;
})();

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
      vol_actual: 9000, vol_actual_mes: 4500, iniciativas: [], ini_total: 0, ret: 0,
      // Columnas [Incidencia] / [Peticion de Servicio] (ExperienciaQueries.VolTipo).
      vol_tipo: { inc: { slot: { 0: 6000, 1: 12, 2: 18 }, mes: { 8: 25, 9: 30, 10: 3000 } },
                  req: { slot: { 0: 2500, 1: 7, 2: 9 }, mes: { 8: 10, 9: 15, 10: 1200 } } } },
  ],
};

function arnes(opciones) {
  opciones = opciones || {};
  var fuente = opciones.fuente || FUENTE;
  var codigo =
    'var fDir="", fPO="", fMgr="", fSO="", tipoRegistro="todos";\n' +
    'var modoTiempo="slot", chartEvol=null, errApi=' + (opciones.errApi ? 'new Error("x")' : 'undefined') + ';\n' +
    'var VERDE={pino:"#p",profundo:"#d",lima:"#l"}, AMBAR_SEM="#a", CIFRAS_EXTREMOS={}, CIFRAS_ENCIMA_BARRAS={};\n' +
    'var document={getElementById:function(id){return ELEMENTOS[id]||(ELEMENTOS[id]={style:{},innerHTML:""});}};\n' +
    'function FMT(n){return String(Math.round(n||0));}\n' +
    'var KPIS_SLA_URL="http://x/handlers/kpis.ashx"; var REPINTADOS=[];\n' +
    'function aggCats(){return P.categorias;} function currentCats(){return P.categorias;}\n' +
    'function renderKPIs(){REPINTADOS.push("kpis:"+modoTiempo);}\n' +
    bloque(fuente, '/* === AUTOMATIZADOS SLA (inicio) === */', '/* === AUTOMATIZADOS SLA (fin) === */') +
    bloque(fuente, 'const automatizados = {};', '\nfunction periodosAutomatizados(').replace('const ', 'var ') +
    ['volSlotOMes', 'pronosticoMes', 'automatizadosDe', 'hayFiltrosAutomatizados', 'periodosAutomatizados', 'pedirAutomatizados',
     'tarjetaSinAutomatizar', 'volActualDe'].map(function (n) { return recortar(fuente, n); }).join('') +
    bloque(fuente, 'const AYUDA_SIN_AUTOMATIZAR=', '\nfunction tarjetaSinAutomatizar(').replace('const ', 'var ') +
    // El selector de tipo de verdad: sustituye los campos de volumen.
    bloque(fuente, 'const TIPOS_REGISTRO=', '\n// Sin vol_tipo').replace(/const /g, 'var ') +
    ['camposVolumenTipo', 'aplicarTipoRegistro'].map(function (n) { return recortar(fuente, n); }).join('') +
    recortar(opciones.fuenteEvol || fuente, 'renderEvol') +
    // renderKPIs de verdad, con lo que no es de esta tarjeta de mentira.
    'var AGR=[], ESTADOS_ACTIVOS=[];\n' +
    // Sin SeleccionKpi: las tarjetas salen como antes del clic que filtra.
    'var seleccionKpi=null;\n' +
    'var Escape={attr:function(s){return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;");}};\n' +
    'function PCT(n){return String(Math.round((n||0)*100))+"%";} function SEM(){return null;}\n' +
    'function volumenConIniciativa(){return 0;} function hojasSinIniciativa(){return [];} function volumenSinIniciativa(){return 0;}\n' +
    'function tarjetaEfectividad(){return {l:"Ef",v:"x",f:"",s:null};}\n' +
    recortar(fuente, 'renderKPIs').replace('function renderKPIs(', 'function renderKPIsReal(') +
    '\nvar renderEvolReal=renderEvol; renderEvol=function(c){REPINTADOS.push("evol:"+modoTiempo); renderEvolReal(c);};' +
    '\nreturn {' +
    ' modo: function (m) { modoTiempo = m; },' +
    ' filtrar: function (d, p, m, s, t) { fDir = d || ""; fPO = p || ""; fMgr = m || ""; fSO = s || ""; aplicarTipoRegistro(t || "todos"); },' +
    // Lo que hace el boton de tipo antes de renderAll (que vuelve a pedir).
    ' tipo: function (t) { aplicarTipoRegistro(t); },' +
    ' filtros: function () { return {dir: fDir, po: fPO, mgr: fMgr, so: fSO, modo: modoTiempo, tipo: tipoRegistro}; },' +
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
  var A = new Function('ELEMENTOS', 'P', 'Chart', 'CHARTS', 'traer', 'console', 'Paleta', codigo)(
    ELEMENTOS, JSON.parse(JSON.stringify(opciones.payload || PAYLOAD)), Chart, CHARTS, opciones.traer || function () {
      return Promise.reject(new Error('sin traer'));
    }, { warn: function () {} }, PALETA);
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
// Mismo azul que las barras de Call Center: AZUL = Paleta.porIndice(0) en
// dashboard.js, que es Paleta.AZUL_SERIE = #2563eb (assets/js/paleta.js).
Check('G9 Call Center pinta sus barras con Paleta.porIndice(0) = #2563eb', [true, '#2563eb', '#2563eb'],
  [/const AZUL = Paleta\.porIndice\(0\)/.test(fs.readFileSync(path.join(raiz, 'dashboard.js'), 'utf8')),
   PALETA.porIndice(0), PALETA.AZUL_SERIE]);
Check('G9 barras Automatizados SLA en #2563eb, sin borde de otro color', ['#2563eb', undefined],
  [con.data.datasets[1].backgroundColor, con.data.datasets[1].borderColor]);
Check('G9 la muestra de la leyenda es el mismo azul', true, /<i style="background:#2563eb"><\/i>Automatizados SLA/.test(A.elementos.legendEvol.innerHTML));
Check('G9 la linea conserva sus colores', ['#p', 'rgba(47,143,107,.14)'], [con.data.datasets[0].borderColor, con.data.datasets[0].backgroundColor]);
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
 ['M1 SO', ['', '', '', 'SO X']], ['M1 Director + Incidentes', ['Dir A', '', '', '', 'inc']],
 ['M1 SO + Requerimientos', ['', '', '', 'SO X', 'req']]].forEach(function (c) {
  // Con tipo la linea es la de ese tipo: se compara con el tipo solo, sin dueños.
  var lineaSin = c[1][4] ? conFiltro('', '', '', '', c[1][4]).linea : sinFunciones(mBase.data.datasets[0]);
  var r = conFiltro.apply(null, c[1]);
  Check(c[0] + ' oculta las barras y la leyenda lo dice', [1, true, false], [r.series, r.leyenda.indexOf(SOLO) >= 0, r.offset]);
  Check(c[0] + ': la linea es identica a la de sin dueños', lineaSin, r.linea);
  Check(c[0] + ': KPI visible en N/D, no resta el global del filtrado', ['Volumen - Automatizado', 'N/D', SIN_FILTROS],
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
M.estado('slot:inc', { estado: 'listo', valores: { 0: 4, 1: 0, 2: 2 } });
var soloTipo = conFiltro('', '', '', '', 'inc');
Check('M6 el tipo solo no es filtro: barras del tipo, sin "solo sin filtros", y resta', [2, false, '8996'],
  [soloTipo.series, soloTipo.leyenda.indexOf(SOLO) >= 0, soloTipo.tarjeta.v]);
conFiltro();

// ---- K) tarjeta ---------------------------------------------------------
var K = arnes();
var AYUDA = 'Aproximación: tickets registrados en el periodo menos tickets resueltos por bot en el mismo periodo. ' +
  'Los automatizados SLA no necesariamente son un subconjunto del volumen registrado.';
// El aviso va en el title del rotulo, nunca como texto en el pie.
function sinAvisoEnPie(t) { return !/Aprox|subconjunto/i.test(t.f); }
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
Check('K5 9000 - 1500 = 7500 con el SLOT 0', ['Volumen - Automatizado', '7500'], [k5.l, k5.v]);
Check('K5 el pie da solo los dos terminos; el aviso va en el tooltip', ['9000 − 1500 Automatizados SLA', AYUDA],
  [k5.f, k5.t]);
Check('K5 el tooltip va en todos los estados y nunca en el pie', [true, true],
  (function () {
    var vistos = [];
    [{ estado: 'listo', valores: { 0: 0 } }, { estado: 'listo', valores: { 0: null } }, { estado: 'error', valores: {} },
     { estado: 'respaldo', valores: {} }, { estado: 'cargando', valores: {} }].forEach(function (e) {
      K.estado('slot', e); vistos.push(K.tarjeta(false, 9000)); vistos.push(K.tarjeta(false, 0));
    });
    return [vistos.every(function (t) { return t.t === AYUDA; }), vistos.every(sinAvisoEnPie)];
  })());
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
Check('K6 Mes: tooltip, sin aviso en el pie', [AYUDA, true], [kp.t, sinAvisoEnPie(kp)]);
Check('K7 negativo: tooltip y su aviso de siempre en el pie', [AYUDA, true], [kn.t, sinAvisoEnPie(kn)]);
Check('K6 Mes sin pronostico: los reales del mes en curso (no del mes 9)', '3750', K.tarjeta(false, 4500).v);

// ---- H) Volumen Actual, la linea y la tarjeta en renderKPIs ---------------
// Linea base fija: el experiencia.js de antes de esta tarjeta. Con HEAD la
// comparacion dejaria de servir en cuanto la tarjeta se commiteara.
var BASE = 'fc83739';
(function () {
  var head;
  try {
    head = limpiar(cp.execSync('git show ' + BASE + ':experiencia/experiencia.js',
      { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (err) { console.log('SKIP  H sin git o sin ' + BASE + ': no se compara la linea base'); return; }
  ['slot', 'mes'].forEach(function (m) {
    var a = arnes(), h = arnes({ fuenteEvol: head });
    var valores = m === 'mes' ? { 8: 1, 9: 2, 10: 3 } : { 0: 1, 1: 2, 2: 3 };
    a.modo(m); h.modo(m);
    a.estado(m, { estado: 'listo', valores: valores });
    Check('H1 ' + m + ': linea identica a la de BASE con las barras puestas',
      sinFunciones(h.evol().data.datasets[0]), sinFunciones(a.evol().data.datasets[0]));
  });
  var kh = recortar(head, 'renderKPIs'), kw = recortar(fuente, 'renderKPIs');
  // Lo unico distinto: la tarjeta nueva, el title opcional del rotulo
  // (solo lo pinta la tarjeta que lo trae) y el clic que filtra de las dos
  // tarjetas con panel (k y SeleccionKpi; sin el, la plantilla de antes).
  var PLANTILLA_CLIC = "  const sel=seleccionKpi;\n" +
    "  document.getElementById('kpis-exp').innerHTML=cards.map(c=>{\n" +
    "    const filtra=!!(c.k && sel);\n" +
    "    return `<div class=\"kpi ${c.s?('s'+c.s):''}${filtra?sel.clases(c.k):''}\"><div class=\"lbl\">${c.l}</div>\n" +
    "     <div class=\"val\">${c.v}</div><div class=\"foot\">${c.f}</div>${filtra?sel.boton(c.k, c.l+': '+c.v):''}</div>`;\n" +
    "  }).join('');\n";
  var PLANTILLA_BASE = "  document.getElementById('kpis-exp').innerHTML=cards.map(c=>\n" +
    "    `<div class=\"kpi ${c.s?('s'+c.s):''}\"><div class=\"lbl\">${c.l}</div>\n" +
    "     <div class=\"val\">${c.v}</div><div class=\"foot\">${c.f}</div></div>`).join('');\n";
  Check('H2 renderKPIs = BASE salvo la tarjeta nueva, el title opcional y el clic (Volumen Actual sin cambios)',
    kh, kw.replace('    tarjetaSinAutomatizar(vol, esPron),\n', '')
      .replace('<div class="lbl"${c.t?` title="${Escape.attr(c.t)}"`:\'\'}>', '<div class="lbl">')
      .replace(",s:null,k:'sin'}", ',s:null}').replace(",s:null,k:'ven'}", ',s:null}')
      .replace(PLANTILLA_CLIC, PLANTILLA_BASE));
})();
var KP = arnes();
KP.estado('slot', { estado: 'listo', valores: { 0: 1500 } });
var html1 = KP.kpis();
var rotulos = (html1.match(/<div class="lbl"[^>]*>[^<]*/g) || []).map(function (x) { return x.replace(/<div class="lbl"[^>]*>/, ''); });
var titles = (html1.match(/<div class="lbl"[^>]*>/g) || []).map(function (x) { var m = / title="([^"]*)"/.exec(x); return m ? m[1] : null; });
Check('H5 el rotulo de Volumen - Automatizado lleva el tooltip; los demas, ninguno',
  [null, AYUDA, null, null, null, null, null], titles);
Check('H5 sin texto de aviso visible en la tarjeta', false, /Aprox|subconjunto/.test(html1.replace(/ title="[^"]*"/g, '')));
Check('H3 Volumen Actual primero y Volumen - Automatizado justo despues', ['Volumen Actual (0-30d)', 'Volumen - Automatizado'],
  rotulos.slice(0, 2));
Check('H3 una sola tarjeta nueva y sin la de conteo', [1, false, false],
  [rotulos.filter(function (r) { return r === 'Volumen - Automatizado'; }).length,
   /Tickets automatizados de SLA/.test(html1), /tarjetaAutomatizados|Tickets automatizados de SLA|'Volumen sin Automatizar'/.test(fuente)]);
var vals = (html1.match(/<div class="val">[^<]*/g) || []).map(function (x) { return x.replace('<div class="val">', ''); });
Check('H4 por renderKPIs: Volumen Actual 9000 y Volumen - Automatizado 7500', ['9000', '7500'], vals.slice(0, 2));

// ---- C) cifra encima de las barras ----------------------------------------
(function () {
  var fuenteBarras = { fuente: function (px) { return 'bold ' + px + 'px x'; }, TINTA_FUERA: '#191919',
    tintaSobre: function (hex) { return hex === '#2563eb' ? '#fff' : '#191919'; } };
  var FMTmx = function (n) { return Math.round(n || 0).toLocaleString('es-MX'); };
  var crear = new Function('Barras', recortar(fuente, 'etiquetasEncimaBarras') + '\nreturn etiquetasEncimaBarras;')(fuenteBarras);
  var plugin = crear(FMTmx);
  // Grafica de mentira: area 0..300 de alto; barras con base en 300.
  function pintar(barras, linea, datosLinea) {
    var hechos = [];
    var ctx = { save: function () {}, restore: function () {}, fillText: function (t, x, y) {
      hechos.push({ t: t, x: x, y: y, base: ctx.textBaseline, tinta: ctx.fillStyle }); } };
    var dsBar = { type: 'bar', data: barras.map(function (b) { return b.v; }), backgroundColor: '#2563eb' };
    var dsLin = { label: 'Volumen', data: datosLinea || linea.map(function () { return 1; }) };
    var metas = [
      { type: 'line', hidden: false, data: linea.map(function (y, i) { return { x: i * 50, y: y }; }) },
      { type: 'bar', hidden: false, data: barras.map(function (b, i) { return { x: i * 50, y: b.y, base: 300 }; }) }];
    plugin.afterDatasetsDraw({ ctx: ctx, chartArea: { top: 0, bottom: 300 }, config: { type: 'line' },
      data: { datasets: [dsLin, dsBar] }, getDatasetMeta: function (k) { return metas[k]; } });
    return hechos;
  }
  // Linea muy por encima de las barras (y=20), barras bajas.
  var r = pintar([{ v: 1500, y: 250 }, { v: 0, y: 300 }, { v: null, y: 300 }, { v: 12345, y: 200 }], [20, 20, 20, 20]);
  Check('C1 una cifra por barra con dato, encima y con miles; null sin cifra', [
    { t: '1,500', x: 0, y: 246, base: 'bottom', tinta: '#191919' },
    { t: '0', x: 50, y: 296, base: 'bottom', tinta: '#191919' },
    { t: '12,345', x: 150, y: 196, base: 'bottom', tinta: '#191919' }], r);
  Check('C2 el cero se pinta y el hueco no se vuelve cero', [true, false],
    [r.some(function (h) { return h.t === '0'; }), r.some(function (h) { return h.x === 100; })]);
  // La linea pasa justo donde iria la cifra (punto intermedio, y=240): adentro.
  var dentro = pintar([{ v: 10, y: 100 }, { v: 900, y: 250 }, { v: 10, y: 100 }], [20, 240, 20]);
  Check('C3 encima chocaria con un punto de la linea: va dentro de la barra, en blanco',
    { t: '900', x: 50, y: 254, base: 'top', tinta: '#fff' }, dentro[1]);
  // Barra corta y punto encima: ni arriba ni dentro cabe -> se omite.
  var omite = pintar([{ v: 10, y: 100 }, { v: 5, y: 292 }, { v: 10, y: 100 }], [20, 284, 20]);
  Check('C4 sin hueco arriba ni dentro: sin cifra (queda el tooltip)', false,
    omite.some(function (h) { return h.t === '5'; }));
  // Ultimo punto de la linea en y=60: su cifra ocupa hasta ~35px alrededor.
  // Encima de la barra (94..106) cae en esa franja; dentro (114..126), no.
  var ext = pintar([{ v: 10, y: 290 }, { v: 700, y: 110 }], [20, 60]);
  Check('C5 respeta la franja de la cifra del ultimo punto de la linea', { t: '700', base: 'top' },
    { t: ext[1].t, base: ext[1].base });
  // Con un punto intermedio a la misma altura (franja de 8px) si cabe encima.
  var med = pintar([{ v: 10, y: 290 }, { v: 700, y: 110 }, { v: 10, y: 290 }], [20, 60, 20]);
  Check('C5 un punto intermedio solo reserva su franja corta', 'bottom', med[1].base);
  // Barra que toca el techo del area: no se sale, va dentro.
  var techo = pintar([{ v: 99999, y: 5 }], [280]);
  Check('C6 sin salirse del area por arriba', { t: '99,999', base: 'top', tinta: '#fff' },
    { t: techo[0].t, base: techo[0].base, tinta: techo[0].tinta });
  Check('C7 la linea no recibe cifras de este plugin: solo las 3 barras con dato', 3, r.length);
  Check('C8 la grafica de Evolucion lleva el plugin junto a CIFRAS_EXTREMOS', true,
    /plugins:\[CIFRAS_EXTREMOS,CIFRAS_ENCIMA_BARRAS\]/.test(recortar(fuente, 'renderEvol')));
})();

// ---- T) tipo de registro ------------------------------------------------
// kpis.ashx de mentira: TicketsAutomatizados por tipo (?tipo, sin el = Todos)
// y por fecha_fin del periodo. null = el rango no tiene ni un resuelto de
// ese tipo (el SUM sobre cero filas de DashboardQueries.Kpis).
var SLA_TIPO = {
  todos: { '2026-10-23': 1500, '2026-09-23': 99, '2026-08-24': 0,
           '2026-08-31': 700, '2026-09-30': 800, '2026-10-31': 750 },
  inc:   { '2026-10-23': 1000, '2026-09-23': 40, '2026-08-24': 0,
           '2026-08-31': 300, '2026-09-30': 350, '2026-10-31': 400 },
  req:   { '2026-10-23': 0, '2026-09-23': 30, '2026-08-24': null,
           '2026-08-31': 100, '2026-09-30': 0, '2026-10-31': 0 },
};
function servidorTipo(urls, datos, especial) {
  return function (u) {
    urls.push(u);
    var q = new URL(u).searchParams, t = q.get('tipo') || 'todos';
    if (especial && especial[t]) return especial[t](u);
    var v = (datos[t] || {})[q.get('fecha_fin')];
    return Promise.resolve({ TicketsAutomatizados: v === undefined ? null : v });
  };
}
function espera() { return new Promise(function (r) { setTimeout(r, 0); }); }
// Las tarjetas de renderKPIs, una por <div class="kpi">: rotulo, valor y pie.
function tarjetas(A) {
  return A.kpis().split('<div class="kpi').slice(1).map(function (h) {
    function de(c) { var m = new RegExp('<div class="' + c + '"[^>]*>([^<]*)').exec(h); return m ? m[1] : null; }
    return { l: de('lbl'), v: de('val'), f: de('foot'), html: h };
  });
}
function rangosDe(urls) {
  return urls.map(function (u) { var q = new URL(u).searchParams;
    return q.get('fecha_inicio') + '|' + q.get('fecha_fin') + '|' + (q.get('tipo') || 'todos'); });
}
// Un tablero en `modo` y `tipo`, ya con la respuesta de SLA pintada.
async function escenario(fuenteX, modo, tipo) {
  var urls = [];
  var A = arnes({ fuente: fuenteX, traer: servidorTipo(urls, SLA_TIPO) });
  A.modo(modo); A.tipo(tipo); A.pedir(modo);
  await espera();
  var g = A.evol();
  return { A: A, urls: urls, tarjetas: tarjetas(A), linea: sinFunciones(g.data.datasets[0]),
    barras: g.data.datasets[1] ? g.data.datasets[1].data : null, grafica: sinFunciones(g),
    leyenda: A.elementos.legendEvol.innerHTML };
}

var ANTES_TIPO = '0985851';   // experiencia.js antes de que la tarjeta respondiera al tipo
async function tipoDeRegistro() {
  var antes = null;
  try {
    antes = limpiar(cp.execSync('git show ' + ANTES_TIPO + ':experiencia/experiencia.js',
      { cwd: raiz, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch (err) { console.log('SKIP  T1 sin git o sin ' + ANTES_TIPO + ': no se compara Todos con la version anterior'); }

  // T1) Todos: exactamente lo de antes, en SLOT y en Mes.
  for (var modo of ['slot', 'mes']) {
    var hoy = await escenario(null, modo, 'todos');
    if (antes) {
      var ant = await escenario(antes, modo, 'todos');
      Check('T1 ' + modo + ' Todos: mismas peticiones que ANTES_TIPO (sin ?tipo)', ant.urls, hoy.urls);
      Check('T1 ' + modo + ' Todos: mismas tarjetas que ANTES_TIPO', ant.tarjetas, hoy.tarjetas);
      Check('T1 ' + modo + ' Todos: misma grafica y leyenda que ANTES_TIPO', [ant.grafica, ant.leyenda], [hoy.grafica, hoy.leyenda]);
    }
    Check('T1 ' + modo + ' Todos: ninguna peticion lleva ?tipo', false, hoy.urls.some(function (u) { return /[?&]tipo=/.test(u); }));
  }
  var todosSlot = await escenario(null, 'slot', 'todos');
  Check('T1 Todos SLOT: 9000 - 1500 = 7500', ['Volumen - Automatizado', '7500', '9000 − 1500 Automatizados SLA'],
    [todosSlot.tarjetas[1].l, todosSlot.tarjetas[1].v, todosSlot.tarjetas[1].f]);

  // T2) Incidentes SLOT: volumen [Incidencia] del SLOT 0 menos automatizados Incidencia del SLOT 0.
  var inc = await escenario(null, 'slot', 'inc');
  Check('T2 Incidentes: Volumen Actual = vol_tipo.inc.slot[0]', '6000', inc.tarjetas[0].v);
  Check('T2 Incidentes: 6000 - 1000 = 5000', ['Volumen - Automatizado', '5000', '6000 − 1000 Automatizados SLA'],
    [inc.tarjetas[1].l, inc.tarjetas[1].v, inc.tarjetas[1].f]);
  Check('T2 Incidentes: una peticion por SLOT, con su rango y ?tipo=inc',
    ['2026-09-24|2026-10-23|inc', '2026-08-25|2026-09-23|inc', '2026-07-26|2026-08-24|inc'], rangosDe(inc.urls));
  Check('T2 Incidentes: barras del tipo (antiguo -> reciente), cero es cero', [0, 40, 1000], inc.barras);
  Check('T2 Incidentes: linea = vol_tipo.inc (antiguo -> reciente)', [18, 12, 6000], inc.linea.data);
  Check('T2 Incidentes: leyenda dice el tipo, sin "solo sin filtros"', [true, false],
    [/Automatizados SLA \(resueltos, global · Incidentes\)/.test(inc.leyenda), /solo sin filtros/.test(inc.leyenda)]);
  if (antes) {
    var incAntes = await escenario(antes, 'slot', 'inc');
    Check('T2 Incidentes: antes era N/D (la falla que se corrige)', 'N/D', incAntes.tarjetas[1].v);
    Check('T8 Incidentes: las demas tarjetas, igual que ANTES_TIPO',
      incAntes.tarjetas.filter(function (_, i) { return i !== 1; }),
      inc.tarjetas.filter(function (_, i) { return i !== 1; }));
  }

  // T3) Requerimientos SLOT: automatizados en CERO se restan como cero.
  var req = await escenario(null, 'slot', 'req');
  Check('T3 Requerimientos: 2500 - 0 = 2500 (cero no es sin dato)', ['2500', '2500 − 0 Automatizados SLA'],
    [req.tarjetas[1].v, req.tarjetas[1].f]);
  Check('T3 Requerimientos: ?tipo=req en las tres peticiones', ['req', 'req', 'req'],
    req.urls.map(function (u) { return new URL(u).searchParams.get('tipo'); }));
  Check('T3/T9 Requerimientos: barra sin dato = hueco, cero = cero', [null, 30, 0], req.barras);

  // T4) Mes: el mes en curso del tipo, con el pronostico de Volumen Actual.
  var incMes = await escenario(null, 'mes', 'inc');
  // dias_transcurridos_mes = 15: pronostico(3000) = 6000, pronostico(400) = 800.
  Check('T4 Mes Incidentes: 6000 - 800 = 5200, real 3000 - 400 = 2600', ['5200', true, true],
    [incMes.tarjetas[1].v, /6000 − 800 Automatizados SLA/.test(incMes.tarjetas[1].f),
     /Real a la fecha: 2600/.test(incMes.tarjetas[1].f)]);
  Check('T4 Mes Incidentes: un mes por peticion con ?tipo=inc',
    ['2026-08-01|2026-08-31|inc', '2026-09-01|2026-09-30|inc', '2026-10-01|2026-10-31|inc'], rangosDe(incMes.urls));
  var reqMes = await escenario(null, 'mes', 'req');
  Check('T4 Mes Requerimientos: pronostico(1200) - 0 = 2400', ['2400', true],
    [reqMes.tarjetas[1].v, /2400 − 0 Automatizados SLA/.test(reqMes.tarjetas[1].f)]);

  // T5) Todos -> Incidentes -> Requerimientos -> Todos en el mismo tablero.
  var urls5 = [], S = arnes({ traer: servidorTipo(urls5, SLA_TIPO) }), seq = [];
  for (var t of ['todos', 'inc', 'req', 'todos', 'inc']) {
    S.tipo(t); S.pedir('slot'); await espera();
    seq.push(tarjetas(S)[1].v);
  }
  Check('T5 Todos -> Inc -> Req -> Todos -> Inc', ['7500', '5000', '2500', '7500', '5000'], seq);
  Check('T5 cada tipo se pide una vez (la vuelta reusa lo pedido)', 9, urls5.length);

  // T6) Los filtros de dueño y "Ver por" se conservan al cambiar el tipo.
  var F6 = arnes({ traer: servidorTipo([], SLA_TIPO) });
  F6.filtrar('Dir A', 'PO X', 'Mgr', 'SO X');
  F6.modo('mes');
  var vistos6 = ['inc', 'req', 'todos'].map(function (t) { F6.tipo(t); return F6.filtros(); });
  Check('T6 Director / PO / Manager / SO y Mes intactos al cambiar el tipo', [
    { dir: 'Dir A', po: 'PO X', mgr: 'Mgr', so: 'SO X', modo: 'mes', tipo: 'inc' },
    { dir: 'Dir A', po: 'PO X', mgr: 'Mgr', so: 'SO X', modo: 'mes', tipo: 'req' },
    { dir: 'Dir A', po: 'PO X', mgr: 'Mgr', so: 'SO X', modo: 'mes', tipo: 'todos' }], vistos6);
  Check('T6 el boton de tipo solo aplica el tipo y repinta (sin tocar dueños ni modo)', [true, false],
    [/botonesTipo\.forEach\(b=>b\.onclick=\(\)=>\{\n  if\(b\.dataset\.tipo===tipoRegistro\) return;\n  aplicarTipoRegistro\(b\.dataset\.tipo\); pintarTipoRegistro\(\); renderAll\(\);\n\}\);/.test(fuente),
     /fDir|fPO|fMgr|fSO|modoTiempo/.test(recortar(fuente, 'aplicarTipoRegistro'))]);
  var conDueno = await (async function () {
    var A = arnes({ traer: servidorTipo([], SLA_TIPO) });
    A.filtrar('Dir A', '', '', '', 'inc'); A.pedir('slot'); await espera();
    return tarjetas(A)[1];
  })();
  Check('T6 dueño + tipo: sigue N/D por el dueño (regla de dueños sin cambio)',
    ['N/D', 'No disponible con filtros: Automatizados SLA es global y no responde a los filtros activos'],
    [conDueno.v, conDueno.f]);

  // T7) Un tipo sin datos: volumen 0 y SLA sin resueltos -> el N/D de "sin dato".
  var vacio = JSON.parse(JSON.stringify(PAYLOAD));
  vacio.categorias[0].vol_tipo.req = { slot: {}, mes: {} };
  var urls7 = [];
  var V = arnes({ payload: vacio, traer: servidorTipo(urls7, { req: {} }) });
  V.tipo('req'); V.pedir('slot'); await espera();
  var v7 = tarjetas(V);
  Check('T7 sin datos: Volumen Actual 0 y "Volumen - Automatizado" N/D de sin dato', ['0', 'N/D', 'SLA sin dato en el periodo'],
    [v7[0].v, v7[1].v, v7[1].f]);
  Check('T7 sin datos: no es el aviso de filtros', false, /No disponible con filtros/.test(v7[1].f));
  Check('T7 sin datos: sin barras con valor (huecos, no ceros)', [null, null, null], (V.evol().data.datasets[1] || {}).data);

  // T9) Error, sin respuesta, respaldo y respuesta tardia no pasan por resultado.
  var E = arnes({ traer: servidorTipo([], SLA_TIPO, { inc: function () { return Promise.reject(new Error('HTTP 500')); } }) });
  E.pedir('slot'); await espera();
  E.tipo('inc'); E.pedir('slot'); await espera();
  var e9 = tarjetas(E)[1], g9 = E.evol();
  Check('T9 error con Incidentes: "—" y el error, sin barras', ['—', 'Error al consultar SLA', 1, true],
    [e9.v, e9.f, g9.data.datasets.length, /error al consultar SLA/.test(E.elementos.legendEvol.innerHTML)]);
  E.tipo('todos');
  Check('T9 el error de Incidentes no toca Todos', '7500', tarjetas(E)[1].v);

  var colgado = arnes({ traer: servidorTipo([], SLA_TIPO, { req: function () { return new Promise(function () {}); } }) });
  colgado.tipo('req'); colgado.pedir('slot'); await espera();
  Check('T9 sin respuesta: consultando, sin resta ni barras', ['…', 'consultando SLA', 1],
    [tarjetas(colgado)[1].v, tarjetas(colgado)[1].f, colgado.evol().data.datasets.length]);

  var R9 = arnes({ errApi: true, traer: function () { throw new Error('no deberia pedir'); } });
  R9.tipo('inc'); R9.pedir('slot');
  Check('T9 respaldo con tipo: no pide y no resta', ['—', 'Respaldo: SLA no disponible'],
    [tarjetas(R9)[1].v, tarjetas(R9)[1].f]);

  var pendientes = [];
  function suelta() { pendientes.forEach(function (r) { r({ TicketsAutomatizados: 1000 }); }); }
  var L = arnes({ traer: servidorTipo([], SLA_TIPO, { inc: function () {
    return new Promise(function (r) { pendientes.push(r); }); } }) });
  L.pedir('slot'); await espera();
  L.tipo('inc'); L.pedir('slot'); await espera();
  L.tipo('todos');
  L.repintados.length = 0;
  suelta(); await espera();
  Check('T9 respuesta tardia de Incidentes ya en Todos: no repinta y Todos sigue 7500', [[], '7500'],
    [L.repintados.slice(), tarjetas(L)[1].v]);
  L.tipo('inc');
  Check('T9 al volver a Incidentes se usa lo que llego (6000 - 1000)', '5000', tarjetas(L)[1].v);
}

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

  await tipoDeRegistro();

  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo paso');
  process.exit(fallos ? 1 : 0);
})();
