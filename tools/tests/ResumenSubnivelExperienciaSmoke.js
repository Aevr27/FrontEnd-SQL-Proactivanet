// tools/tests/ResumenSubnivelExperienciaSmoke.js - Experiencia cuenta el
// volumen de cada Director / Product Owner POR SUBNIVEL (C2), no por el
// servicio (C1).
//
// La fila C1 del payload trae el servicio entero con los dueños de su primera
// fila de CatCategoriaDueno (DirectorioOrganizacional._porC1). Cuando los
// subniveles de un servicio son de dueños distintos -S-Basculas: Aplicativo de
// uno, Hardware de otro (73 tickets, 2026-10-14)- sumar la fila C1 le
// contaba Hardware al dueño de Aplicativo. Lo que fija:
//
//   R) renderResumen / renderResumenPorPO: cada subnivel va a SU Director y
//      a SU PO; el total es el de aggCats (la tarjeta de volumen) y, sin
//      filtros, igual a la suma de las filas C1 (no duplica ni pierde);
//   D) renderDet: el renglon C1 es la fila C1 tal cual si se ven todos sus
//      subniveles; con un filtro que esconde alguno, la suma de los que se
//      ven (volumen, Con Iniciativa y dueño comun).
//
// NO forma parte del sitio. Recorta las funciones del propio experiencia.js
// (mismo patron que FiltroDuenosExperienciaSmoke.js) y las corre con un DOM y
// unas graficas de mentira. conIniVolDe se sustituye por una tabla fija: su
// propia regla no es lo que se prueba aqui.
//
// Como correrla (desde la raiz del repositorio):
//   node tools\tests\ResumenSubnivelExperienciaSmoke.js   # sale 0 si todo paso
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

// Payload minimo con la forma de ExperienciaQueries.ArmarCategorias. La fila
// C1 de S-Basculas lleva los dueños de Aplicativo (la primera del catalogo).
function cat(nivel, c1, categoria, vol, director, po, so) {
  return { nivel: nivel, c1: c1, categoria: categoria, vol_actual: vol, vol_anterior: vol,
    delta: 0, vol_actual_mes: vol * 2, vol_anterior_mes: 0, delta_mes: vol * 2,
    ini_total: 0, ret: 1, pct_en_tiempo: 1, director: director, po: po, so: so, manager: '' };
}
var P = { categorias: [
  cat('C1', 'S-Basculas', 'S-Basculas', 173, 'Dir Uno', 'PO Aplicativo', 'SO A'),
  cat('C2', 'S-Basculas', '/S-Basculas/Aplicativo', 100, 'Dir Uno', 'PO Aplicativo', 'SO A'),
  cat('C2', 'S-Basculas', '/S-Basculas/Hardware', 73, 'Dir Dos', 'PO Hardware', 'SO H'),
  cat('C1', 'Red', 'Red', 50, 'Dir Dos', 'PO Hardware', 'SO H'),
  cat('C2', 'Red', '/Red', 50, 'Dir Dos', 'PO Hardware', 'SO H'),
  // C1 sin subniveles (solo existe por una iniciativa): aggCats lo cuenta.
  cat('C1', 'Solo', 'Solo', 5, 'Dir Uno', 'PO Aplicativo', 'SO A'),
] };
var CON_INI = { 'S-Basculas': 30, '/S-Basculas/Aplicativo': 20, '/S-Basculas/Hardware': 10,
  'Red': 7, '/Red': 7, 'Solo': 0 };

var elementos = {};
var codigo =
  'var fDir="", fPO="", fMgr="", fSO="", modoTiempo="slot";\n' +
  'var chartBarDir=null;\n' +
  'var barrasPO={}, barraDir=null;\n' +
  'var document={getElementById:function(id){return ELEMENTOS[id]||(ELEMENTOS[id]={style:{},classList:{add:function(){},remove:function(){}}});}};\n' +
  'function FMT(n){return String(n);} function esc(s){return String(s);} function PCT(n){return String(n);}\n' +
  'function tend(){return "";} function miniBar(){return "";} function badge(){return "";}\n' +
  'function bindC1toggle(){} function bindArbolToggle(){} function bindCatClicks(){} function registrarDimension(){}\n' +
  'function conIniVolDe(c){var k=c.categoria; if(!(k in CON_INI)) throw new Error("conIniVolDe "+k); return CON_INI[k];}\n' +
  'function DashboardBarChart(o){barraDir=o; this.render=function(){};}\n' +
  'function renderBarrasPO(id, filas){barrasPO[id]=filas;}\n' +
  recortar('pasaFiltroGlobal') + recortar('volActualDe') + recortar('volAnteriorDe') + recortar('deltaDe') +
  recortar('currentCats') + recortar('aggCats') + recortar('renderDet') +
  recortar('iniRetPorRutaDet') + recortar('arbolDescendientesDet') + recortar('filasDescendientesDet') +
  recortar('renderResumen') + recortar('renderResumenPorPO') +
  '\nreturn {' +
  ' filtrar: function (d, p, m, s) { fDir = d || ""; fPO = p || ""; fMgr = m || ""; fSO = s || ""; },' +
  ' modo: function (m) { modoTiempo = m; },' +
  ' det: function () { renderDet(currentCats()); return ELEMENTOS.bodyDet.innerHTML; },' +
  ' resumen: function () { renderResumen(); return { tabla: ELEMENTOS.bodyDirectores.innerHTML, barraDir: barraDir, po: barrasPO.chartBarPO }; },' +
  ' porPO: function (dir) { renderResumenPorPO(dir); return ELEMENTOS.bodyDirectores.innerHTML; },' +
  ' tarjeta: function () { return aggCats().reduce(function (s, c) { return s + volActualDe(c); }, 0); } };';
var tablero = (new Function('P', 'ELEMENTOS', 'CON_INI', codigo))(P, elementos, CON_INI);

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

// Filas de la tabla de indicadores: nombre -> [vol, pct, ini, ..., ret, ...].
function filasTabla(html) {
  var out = {};
  html.split('<tr>').slice(1).forEach(function (tr) {
    var nombre = /<b>([^<]*)<\/b>/.exec(tr)[1];
    var nums = [];
    tr.replace(/<td class="num">([^<]*)<\/td>/g, function (_, n) { nums.push(n.trim()); });
    out[nombre] = nums;
  });
  return out;
}
// Renglones C1 del detalle: c1 -> {vol, conIni, po, so}.
function renglonesC1(html) {
  var out = {};
  html.split('<tr class="c1row"').slice(1).forEach(function (tr) {
    tr = tr.split('<tr class="c2row')[0];
    var c1 = /<span class="catclick"[^>]*>([^<]*)<\/span>/.exec(tr)[1];
    var tds = [];
    tr.replace(/<td[^>]*>([\s\S]*?)<\/td>/g, function (_, t) { tds.push(t.trim()); });
    out[c1] = { vol: tds[2], conIni: tds[4], po: tds[8], so: tds[9] };
  });
  return out;
}

// ---- R) Indicadores por Director / PO ----
tablero.filtrar();
var r = tablero.resumen();
var dirs = filasTabla(r.tabla);
Check('R1 sin filtros: Dir Uno = Aplicativo + Solo, sin Hardware', '105', dirs['Dir Uno'][0]);
Check('R2 sin filtros: Dir Dos = Hardware + Red', '123', dirs['Dir Dos'][0]);
Check('R3 total = tarjeta de volumen (aggCats)', tablero.tarjeta(), Number(dirs['Dir Uno'][0]) + Number(dirs['Dir Dos'][0]));
Check('R4 total = suma de las filas C1 (no duplica ni pierde)', 173 + 50 + 5, tablero.tarjeta());
Check('R5 Con Iniciativa por subnivel: Dir Uno', '20', dirs['Dir Uno'][2]);
Check('R6 Con Iniciativa por subnivel: Dir Dos', '17', dirs['Dir Dos'][2]);
Check('R7 retrasados por subnivel: Dir Uno (Aplicativo + Solo)', '2', dirs['Dir Uno'][4]);
Check('R8 barra de Director con las mismas cifras', '123,105', r.barraDir.datos.join(','));
Check('R9 barras PO por subnivel',
  'PO Hardware=123,PO Aplicativo=105', r.po.map(function (x) { return x.po + '=' + x.vol; }).join(','));

tablero.filtrar('Dir Uno');
var pos = filasTabla(tablero.porPO('Dir Uno'));
Check('R10 Director filtrado: solo sus subniveles', 'PO Aplicativo', Object.keys(pos).join(','));
Check('R11 Director filtrado: volumen sin Hardware', '105', pos['PO Aplicativo'][0]);
tablero.filtrar('Dir Dos');
pos = filasTabla(tablero.porPO('Dir Dos'));
Check('R12 el Director de Hardware lo ve aunque la fila C1 sea de otro', '123', pos['PO Hardware'][0]);

tablero.filtrar(); tablero.modo('mes');
dirs = filasTabla(tablero.resumen().tabla);
Check('R13 modo Mes usa vol_actual_mes por subnivel', '210', dirs['Dir Uno'][0]);
tablero.modo('slot');

// ---- D) Detalle por categoria ----
tablero.filtrar();
var d = renglonesC1(tablero.det());
Check('D1 sin filtros: el renglon C1 es la fila C1 tal cual', '173', d['S-Basculas'].vol);
Check('D2 sin filtros: Con Iniciativa del servicio entero', '30', d['S-Basculas'].conIni);
Check('D3 sin filtros: dueños de la fila C1', 'PO Aplicativo', d['S-Basculas'].po);
Check('D4 orden por volumen del renglon', 'S-Basculas,Red,Solo', Object.keys(d).join(','));

tablero.filtrar('', 'PO Aplicativo');
d = renglonesC1(tablero.det());
Check('D5 PO de Aplicativo: S-Basculas sin Hardware', '100', d['S-Basculas'].vol);
Check('D6 PO de Aplicativo: Con Iniciativa sin Hardware', '20', d['S-Basculas'].conIni);
Check('D7 PO de Aplicativo: no ve Red', false, 'Red' in d);
Check('D8 PO de Aplicativo: C1 sin subniveles sigue completo', '5', d['Solo'].vol);

tablero.filtrar('', 'PO Hardware');
d = renglonesC1(tablero.det());
Check('D9 PO de Hardware: S-Basculas solo Hardware', '73', d['S-Basculas'].vol);
Check('D10 PO de Hardware: dueño comun de lo que se ve', 'PO Hardware', d['S-Basculas'].po);
Check('D11 PO de Hardware: SO comun de lo que se ve', 'SO H', d['S-Basculas'].so);
Check('D12 PO de Hardware: orden por el renglon filtrado', 'S-Basculas,Red', Object.keys(d).join(','));

tablero.filtrar('', '', '', 'SO A');
d = renglonesC1(tablero.det());
Check('D13 Service Owner tambien corta por subnivel', '100', d['S-Basculas'].vol);

console.log('');
console.log(fallos ? fallos + ' FALLO(S)' : 'TODO PASA');
process.exit(fallos ? 1 : 0);
