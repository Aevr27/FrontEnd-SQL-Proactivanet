// tools/tests/TiATiExperienciaSmoke.js - boton "TI a TI" de Experiencia.
//
// Los requerimientos de TI a TI (App_Code/TicketTIaTI.cs) llegan de
// handlers/experiencia_ti.ashx por categoria y periodo; con el boton,
// camposVolumenTipo los resta del volumen de cada categoria. Lo que fija:
//
//   I)  abre con ellos: boton "Incluidos" deshabilitado hasta tener datos,
//       casilla de permisos marcada;
//   A)  apagado, con o sin datos, pinta lo mismo que antes;
//   Q)  con el boton: tarjeta, evolucion, detalle, Con / Sin Iniciativa y
//       folio, todo sin ellos; el pie de la tarjeta dice cuantos;
//   P)  sin la casilla, los de permisos se quedan;
//   T)  con el tipo: Requerimientos tambien baja, Incidentes no cambia;
//   M)  "Ver por" Mes usa la serie del mes;
//   D)  sin duplicados: KPI-2 + KPI-5 = hojas = tarjeta, C1 = sus rutas;
//   C)  nunca negativo (las dos lecturas no son la misma consulta);
//   R)  apagarlo deja el payload como llego;
//   U)  lo que se pide al servidor (automatizados y descarga) y su llave;
//   L)  "Limpiar" y volver a la pestaña lo regresan; la regla del servidor
//       es la del 89 y SLA no la ofrece.
//
// NO forma parte del sitio. Recorta las funciones del propio experiencia.js
// (patron de TipoRegistroExperienciaSmoke.js) y las corre con un DOM y una
// Chart de mentira.
//
// Como correrla (desde la raiz del sitio):
//   node tools\tests\TiATiExperienciaSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(r) { return fs.readFileSync(path.join(raiz, r), 'utf8').split(String.fromCharCode(13)).join(''); }
var fuente = leer('experiencia/experiencia.js');
var html = leer('experiencia/experiencia.html');

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
function copia(o) { return JSON.parse(JSON.stringify(o)); }

// ---- payload (la forma de ExperienciaQueries) -------------------------
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
// slot 0:             Todos Inc Req | TI (permisos)
//   /Red/LAN/Switch     10    6   3 |  2 (1)
//   /Red/WAN             5    0   5 |  3
//   /Sorx/Bot            3    0   0 |  -
//   total               18    6   8 |  5 (1)
var sSwitch = S(10, 8, 9, 6, 4, 7, 3, 2, 1);
var sWan = S(5, 2, 4, 0, 0, 0, 5, 2, 4);
var sBot = S(3, 0, 3, 0, 0, 0, 0, 0, 0);
var sRed = S(15, 10, 13, 6, 4, 7, 8, 4, 5);
var PAYLOAD = {
  mes_actual: MES, anio: 2026,
  slot_nums: [0, 1], mes_nums: [MES - 1, MES], meses: ['Sep', 'Oct'],
  agrupadores: ['Problem'],
  categorias: [
    cat('C1', 'Red', 'Red', sRed, 'Dir A', 'PO Red'),
    cat('C2', 'Red', '/Red/LAN', sSwitch, 'Dir A', 'PO Red'),
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
// La respuesta de experiencia_ti.ashx: C1 y C1&C2 en "categorias" (el mismo
// repliegue que el volumen) y las rutas en "categorias_v2".
function T(s0, s1, m, p0) {
  var o = { slot: {}, mes: {}, permisos_slot: {}, permisos_mes: {} };
  if (s0) o.slot['0'] = s0; if (s1) o.slot['1'] = s1; if (m) o.mes[String(MES)] = m; if (p0) o.permisos_slot['0'] = p0;
  return o;
}
var TI = {
  anio: 2026, regla: { servicio_ti: 'S-Servicios TI', cliente: 'OAT', permisos: 'S-Acceso Aplicaciones - Permisos' },
  categorias: { 'Red': T(5, 1, 3, 1), '/Red/LAN': T(2, 1, 1, 1), '/Red/WAN': T(3, 0, 2, 0) },
  categorias_v2: { '/Red/LAN/Switch': T(2, 1, 1, 1), '/Red/WAN': T(3, 0, 2, 0) },
};

// ---- arnes ------------------------------------------------------------
var COMUNES = ['pasaFiltroGlobal', 'volActualDe', 'volAnteriorDe', 'deltaDe', 'volSlotOMes',
  'currentCats', 'aggCats', 'renderKPIs', 'tarjetaVolumenActual', 'efectividadDe', 'tarjetaEfectividad', 'tarjetaSinAutomatizar', 'renderEvol', 'renderDet',
  'volCatV2', 'getConDescendienteConVolumen', 'esHojaPeriodo', 'conDeCatV2', 'sinDeCatV2',
  'hojasSinIniciativa', 'volumenSinIniciativa', 'volumenConIniciativa', 'conIniVolDe', 'renderSin',
  'catV2ByPath', 'categoriasDeFolio', 'volumenCategoriasFolio',
  'iniRetPorRutaDet', 'arbolDescendientesDet', 'filasDescendientesDet'];
function pronosticoDe(src) {
  var a = '/* === PRONOSTICO MES (inicio) === */', b = '/* === PRONOSTICO MES (fin) === */';
  return src.slice(src.indexOf(a), src.indexOf(b)) + recortar(src, 'pronosticoVista') +
    /const TAG_PRON=[^\n]*\n/.exec(src)[0].replace('const ', 'var ');
}
function arnes(payload) {
  var codigo =
    'var fDir="", fPO="", fMgr="", fSO="", modoTiempo="slot", chartEvol=null;\n' +
    'var _cacheHojaPeriodo={modo:null, tipo:null, set:null};\n' +
    'var AGR=P.agrupadores, ESTADOS_ACTIVOS=["En Análisis","En Solución","En Monitoreo"];\n' +
    'var seleccionKpi=null;\n' +
    'var VERDE={pino:"",profundo:""}, AMBAR_SEM="", CIFRAS_EXTREMOS={}, CIFRAS_ENCIMA_BARRAS={}, ACOLOR={}, NEUTRO_SEM="";\n' +
    'function automatizadosDe(){return null;} function hayFiltrosAutomatizados(){return false;}\n' +
    'var AYUDA_SIN_AUTOMATIZAR="", Escape={attr:function(s){return String(s);}}, Paleta={AZUL_SERIE:"#2563eb"};\n' +
    'var document={getElementById:function(id){return ELEMENTOS[id]||(ELEMENTOS[id]={style:{},classList:{add:function(){},remove:function(){}}});}};\n' +
    'function FMT(n){return String(Math.round(n||0));} function PCT(n){return String(Math.round((n||0)*100))+"%";}\n' +
    'function SEM(){return "v";} function esc(s){return String(s);} function fdate(){return "";}\n' +
    'function tend(){return "";} function miniBar(){return "";} function badge(){return "";} function badgeBin(){return "";}\n' +
    'function bindC1toggle(){} function bindC2toggle(){} function bindArbolToggle(){} function bindCatClicks(){}\n' +
    fuente.slice(fuente.indexOf('let tipoRegistro='), fuente.indexOf('\nfunction camposVolumenTipo(')) +
    recortar(fuente, 'camposVolumenTipo') + recortar(fuente, 'aplicarTipoRegistro') +
    recortar(fuente, 'ponerTIaTI') + recortar(fuente, 'claveAutomatizados') +
    pronosticoDe(fuente) +
    COMUNES.map(function (n) { return recortar(fuente, n); }).join('') +
    '\nreturn {' +
    ' ti: tiATi,' +
    ' poner: function (sin, perm) { return ponerTIaTI(sin, perm); },' +
    ' tipo: function (t) { aplicarTipoRegistro(t); },' +
    ' filtrar: function (d) { fDir = d || ""; },' +
    ' modo: function (m) { modoTiempo = m; },' +
    ' cuantos: function () { return cuantosTIaTI(aggCats()); },' +
    ' params: function () { return parametrosTIaTI(); },' +
    ' clave: function (m) { return claveAutomatizados(m); },' +
    ' estadoTexto: function () { return textoEstadoTIaTI(); },' +
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
function pie(kpis) { var m = /<div class="foot">([^<]*)<\/div>/.exec(kpis); return m ? m[1] : null; }

// ---- I) como abre ----
var bTi = /<button[^>]*id="btnTiATi"[^>]*>([^<]*)<\/button>/.exec(html);
Check('I1 el boton abre "Incluidos", data-estado todos, deshabilitado hasta tener datos',
  ['Incluidos', true, true], [bTi && bTi[1], /data-estado="todos"/.test(bTi[0]), /\sdisabled[\s>]/.test(bTi[0])]);
Check('I2 la casilla de permisos abre marcada', true, /id="chkTiPermisos" checked/.test(html));
Check('I3 la nota de que quito empieza escondida', true, /id="notaTiATi" hidden/.test(html));
var A = arnes(copia(PAYLOAD));
Check('I4 estado inicial: con ellos, permisos marcada, sin datos', [false, true, null, 'pendiente'],
  [A.ti.sin, A.ti.permisos, A.ti.datos, A.ti.estado]);

// ---- A) apagado = como antes ----
var antes = A.pintar();
A.ti.datos = copia(TI); A.ti.estado = 'listo';
var conDatos = A.pintar();
Check('A1 con datos y apagado pinta lo mismo', JSON.stringify(antes), JSON.stringify(conDatos));
Check('A2 apagado: lo que quitaria en el SLOT 0 (5 de 18)', [18, 5], [conDatos.tarjeta, A.cuantos()]);

// ---- Q) con el boton ----
Check('Q0 poner cambia algo', true, A.poner(true, true));
var sin = A.pintar();
Check('Q1 tarjeta sin TI a TI: 18 - 5', 13, sin.tarjeta);
Check('Q2 evolucion SLOT: [10-1, 18-5]', [9, 13], sin.evol);
Check('Q3 el pie dice cuantos se quitaron, primero', true, /^sin 5 de TI a TI · /.test(pie(sin.kpis)));
Check('Q4 detalle y Sin iniciativa cambian', [true, true], [sin.det !== conDatos.det, sin.sin !== conDatos.sin]);
Check('Q5 Con / Sin Iniciativa (Switch reduce 4 sobre 8)', [4, 9], [sin.con, sin.sinIni]);
Check('Q6 volumen del folio P1 (Switch 10 - 2)', 8, sin.folio);
Check('Q7 lo que quita = lo que se ve de menos', conDatos.tarjeta - sin.tarjeta, A.cuantos());
Check('Q8 poner lo mismo otra vez no cambia nada', false, A.poner(true, true));

// ---- D) sin duplicados ----
Check('D1 KPI-2 + KPI-5 = hojas = tarjeta', [13, 13], [sin.con + sin.sinIni, sin.hojas]);

// ---- P) la casilla de permisos ----
A.poner(true, false);
var perm = A.pintar();
Check('P1 sin la casilla se quedan los de permisos: 18 - 4', [14, 4], [perm.tarjeta, A.cuantos()]);
Check('P2 evolucion: el SLOT 1 no tiene de permisos', [9, 14], perm.evol);
Check('P3 texto del estado', 'Sin TI a TI (con los de permisos)', A.estadoTexto());

// ---- T) con el tipo ----
A.poner(true, true);
A.tipo('req');
var req = A.pintar();
Check('T1 Requerimientos sin TI a TI: (3-2) + (5-3)', [3, 5], [req.tarjeta, A.cuantos()]);
A.tipo('inc');
var inc = A.pintar();
Check('T2 Incidentes no cambia (todos los de TI a TI son peticiones)', [6, 0], [inc.tarjeta, A.cuantos()]);
A.tipo('todos');

// ---- M) por mes ----
A.modo('mes');
var mes = A.pintar();
Check('M1 Mes: 16 - 3 (Switch 9-1, WAN 4-2, Bot 3)', [13, 3], [mes.tarjeta, A.cuantos()]);
A.modo('slot');

// ---- F) con un Director ----
A.filtrar('Dir B');
Check('F1 Director B no tiene de TI a TI', [3, 0], [A.pintar().tarjeta, A.cuantos()]);
A.filtrar('');

// ---- C) nunca negativo ----
var B = arnes(copia(PAYLOAD));
var raro = copia(TI);
raro.categorias_v2['/Sorx/Bot'] = T(9, 0, 9, 0);
raro.categorias['Sorx'] = T(9, 0, 9, 0);
raro.categorias['/Sorx/Bot'] = T(9, 0, 9, 0);
B.ti.datos = raro; B.ti.estado = 'listo';
B.poner(true, true);
var cr = B.pintar();
Check('C1 una categoria con mas TI a TI que volumen queda en 0, no negativa', [10, 8], [cr.tarjeta, B.cuantos()]);

// ---- R) apagarlo deja todo como llego ----
var R = arnes(copia(PAYLOAD));
R.ti.datos = copia(TI); R.ti.estado = 'listo';
var r0 = R.pintar();
R.poner(true, true); R.tipo('req'); R.poner(true, false); R.tipo('todos'); R.poner(false, true);
var r1 = R.pintar();
Check('R1 encender, cambiar de tipo y apagar pinta lo mismo que al abrir', JSON.stringify(r0), JSON.stringify(r1));

// ---- U) lo que se pide al servidor ----
var U = arnes(copia(PAYLOAD));
Check('U1 apagado: sin parametros y la llave de siempre', [[], 'slot', 'mes'], [U.params(), U.clave('slot'), U.clave('mes')]);
U.ti.datos = copia(TI); U.ti.estado = 'listo';
U.poner(true, true);
Check('U2 sin TI a TI', [[['ti', 'excluir']], 'slot|ti=excluir'], [U.params(), U.clave('slot')]);
U.poner(true, false); U.tipo('req');
Check('U3 dejando permisos, con tipo', [[['ti', 'excluir'], ['ti_permisos', 'dejar']], 'mes:req|ti=excluir&ti_permisos=dejar'],
  [U.params(), U.clave('mes')]);
var pedir = recortar(fuente, 'pedirAutomatizados');
Check('U4 automatizados: manda los parametros y solo repinta si la llave sigue igual', [true, true],
  [/parametrosTIaTI\(\)\.forEach\(\(\[k,v\]\)=>url\.searchParams\.set\(k, v\)\)/.test(pedir),
   /claveAutomatizados\(modo\)!==clave\) return;/.test(pedir)]);
var exp = fuente.slice(fuente.indexOf('async function pedirTicketsExport('), fuente.indexOf('let xlsxCargando='));
Check('U5 la descarga manda los mismos parametros', true, /parametrosTIaTI\(\)\.forEach/.test(exp));
Check('U6 el libro dice el estado del boton en su cabecera', true, /\['TI a TI', textoEstadoTIaTI\(\)\]/.test(fuente));

// ---- L) Limpiar, volver a la pestaña y el servidor ----
var reset = fuente.slice(fuente.indexOf("document.getElementById('btnReset').onclick=()=>{"));
reset = reset.slice(0, reset.indexOf('\n};\n'));
Check('L1 Limpiar regresa TI a TI antes de repintar', true, /limpiarTIaTI\(\);[\s\S]*renderAll\(\);\s*$/.test(reset));
Check('L2 el modulo publica alVolver y regresa a Incluidos', true,
  /alVolver: \(\)=>\{ if\(ponerTIaTI\(false, true\)\) renderAll\(\); \}/.test(fuente));
var dash = leer('dashboard.js');
Check('L3 dashboard.js lo llama solo al venir de otra pestaña', [true, true],
  [/MODULOS\[nombre\]\.redimensionar\(anterior !== nombre\);/.test(dash),
   /if \(desdeOtra && modulo && modulo\.alVolver\) modulo\.alVolver\(\);/.test(dash)]);
var regla = leer('App_Code/TicketTIaTI.cs');
// El 89 no esta en este repositorio: sin el, L4 no se da por pasado.
var ruta89 = path.join(raiz, '..', '89_mapa_reduccion.sql');
if (fs.existsSync(ruta89)) {
  var r89 = fs.readFileSync(ruta89, 'utf8');
  var c89 = function (nombre) { var m = new RegExp('DECLARE @' + nombre + ' +NVARCHAR\\(\\d+\\) = N\'([^\']*)\'').exec(r89); return m && m[1]; };
  var cs = function (nombre) { var m = new RegExp('const string ' + nombre + ' = "([^"]*)"').exec(regla); return m && m[1]; };
  Check('L4 la regla del sitio es la del 89: servicio, cliente y permisos',
    [c89('ServicioTI'), c89('PatronOAT'), c89('ServicioPermisos')], [cs('ServicioTI'), '%' + cs('ClienteOAT') + '%', cs('ServicioPermisos')]);
} else {
  console.log('SKIP  L4 la regla del sitio es la del 89 (no hay ' + ruta89 + ')');
}
var dq = leer('App_Code/DashboardQueries.cs');
var desde = dq.slice(dq.indexOf('public static Filtros Desde('), dq.indexOf('\n        }\n', dq.indexOf('public static Filtros Desde(')));
Check('L5 SLA no lo ofrece: Filtros.Desde no lee el boton', false, /TicketTIaTI/.test(desde));
Check('L6 los automatizados si: Predicados aplica TicketTIaTI.Predicado', true,
  /comunes \+= TicketTIaTI\.Predicado\(cmd, f\.TIaTI, "b\.Tipo", "dbo\.fn_CategoriaC1\(b\.Categoria\)", "b\.Cliente", "b\.Tienda"\);/.test(dq));

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO OK');
process.exit(fallos ? 1 : 0);
