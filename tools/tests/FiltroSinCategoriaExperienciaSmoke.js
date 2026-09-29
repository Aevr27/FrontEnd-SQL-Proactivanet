// tools/tests/FiltroSinCategoriaExperienciaSmoke.js - el filtro global de
// Experiencia (Director / Product Owner / Manager / Service Owner) sobre las
// iniciativas SIN categoria (P.iniciativas_sin_categoria).
//
// NO forma parte del sitio. Recorta del propio experiencia.js
// pasaFiltroGlobal, pasaFiltroIniciativa, currentCats y filasBaseAct y las
// corre sobre un payload armado aqui, sin navegador ni SQL.
//
// Lo que fija:
//
//   - una iniciativa sin fila en ProblemCategoria se filtra por SUS dueños
//     (po / so / director / manager de la propia iniciativa). Antes
//     desaparecia con cualquier filtro puesto;
//   - los filtros activos se combinan por AND;
//   - un dueño vacio no coincide con un filtro activo;
//   - las iniciativas CON categoria siguen filtrandose por su categoria;
//   - AGR, ESTADOS_ACTIVOS y la deduplicacion por folio no cambian.
//
// Los folios de prueba modelan dos casos reales de produccion (iniciativas
// sin ProblemCategoria con dueños capturados en el Problem); no dependen de
// sus codigos.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\FiltroSinCategoriaExperienciaSmoke.js
//
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

var mEst = /const ESTADOS_ACTIVOS=(\[[^\]]*\]);/.exec(fuente);
if (!mEst) { console.log('FAIL  ESTADOS_ACTIVOS no esta en experiencia.js'); process.exit(1); }
var ESTADOS_ACTIVOS = JSON.parse(mEst[1]);
var ACTIVO = ESTADOS_ACTIVOS[0];
var AGR = ['Proyecto', 'Mejora'];

function ini(folio, o) {
  var i = { folio: folio, agrup: 'Proyecto', estado: ACTIVO,
            director: null, po: null, manager: null, so: null };
  for (var k in o) i[k] = o[k];
  return i;
}

var P = {
  categorias: [
    { categoria: 'S-Ventas', nivel: 'C1',
      director: 'Dir-Cat', po: 'PO-Cat', manager: 'Mgr-Cat', so: 'SO-Cat',
      iniciativas: [
        // La iniciativa pinta dueños distintos a los de su categoria: el
        // filtro sigue siendo el de la categoria.
        ini('C1', { director: 'Dir-Otro', po: 'PO-Otro', manager: 'Mgr-Otro', so: 'SO-Otro' }),
        ini('DUP', { director: 'Dir-Cat', po: 'PO-Cat', manager: 'Mgr-Cat', so: 'SO-Cat' })
      ] }
  ],
  iniciativas_sin_categoria: [
    // Modela el primer caso real: los cuatro dueños resueltos.
    ini('S1', { director: 'Dir-A', po: 'PO-A', manager: 'Mgr-A', so: 'SO-A' }),
    // Modela el segundo: sin Manager (el SO no esta en CatPersona) ni PO.
    ini('S2', { director: 'Dir-A', po: null, manager: null, so: 'SO-B' }),
    ini('S-CERRADA', { director: 'Dir-A', estado: 'Cerrado' }),
    ini('S-AGR', { director: 'Dir-A', agrup: 'ReqOpr' }),
    // Mismo folio que una iniciativa con categoria: no se duplica.
    ini('DUP', { director: 'Dir-A', po: 'PO-A', manager: 'Mgr-A', so: 'SO-A' })
  ]
};

var codigo =
  'var fDir="", fPO="", fMgr="", fSO="";\n' +
  recortar('pasaFiltroGlobal') + recortar('pasaFiltroIniciativa') +
  recortar('currentCats') + recortar('filasBaseAct') +
  '\nreturn { filtrar: function (d, p, m, s) { fDir = d; fPO = p; fMgr = m; fSO = s; },' +
  ' activas: function () { return filasBaseAct(currentCats()); } };';
var tablero = (new Function('P', 'AGR', 'ESTADOS_ACTIVOS', codigo))(P, AGR, ESTADOS_ACTIVOS);

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}
function filas(d, p, m, s) {
  tablero.filtrar(d || '', p || '', m || '', s || '');
  return tablero.activas();
}
function ve(folio, d, p, m, s) {
  return filas(d, p, m, s).some(function (r) { return r.folio === folio; });
}

// 1
Check('1 sin filtros: sin categoria visible', true, ve('S1'));
// 2-9
Check('2 Director coincide', true, ve('S1', 'Dir-A'));
Check('3 Director ajeno', false, ve('S1', 'Dir-X'));
Check('4 PO coincide', true, ve('S1', '', 'PO-A'));
Check('5 PO ajeno', false, ve('S1', '', 'PO-X'));
Check('6 Manager coincide', true, ve('S1', '', '', 'Mgr-A'));
Check('7 Manager ajeno', false, ve('S1', '', '', 'Mgr-X'));
Check('8 SO coincide', true, ve('S1', '', '', '', 'SO-A'));
Check('9 SO ajeno', false, ve('S1', '', '', '', 'SO-X'));
// 10
Check('10 AND: los cuatro coinciden', true, ve('S1', 'Dir-A', 'PO-A', 'Mgr-A', 'SO-A'));
Check('10 AND: Director coincide, Manager no', false, ve('S1', 'Dir-A', '', 'Mgr-X'));
Check('10 AND: Director y SO coinciden', true, ve('S2', 'Dir-A', '', '', 'SO-B'));
// 11
Check('11 sin PO: fuera con filtro de PO', false, ve('S2', '', 'PO-A'));
Check('11 sin Manager: fuera con filtro de Manager', false, ve('S2', '', '', 'Mgr-A'));
Check('11 sin PO: visible sin filtro de PO', true, ve('S2', 'Dir-A'));
// 12
Check('12 con categoria: visible con el Director de su categoria', true, ve('C1', 'Dir-Cat'));
Check('12 con categoria: fuera con el Director que pinta la iniciativa', false, ve('C1', 'Dir-Otro'));
Check('12 con categoria: fuera con el PO que pinta la iniciativa', false, ve('C1', '', 'PO-Otro'));
// 13
Check('13 estado no activo sigue fuera', false, ve('S-CERRADA'));
Check('13 estado no activo sigue fuera con filtro', false, ve('S-CERRADA', 'Dir-A'));
Check('13 agrupador ajeno sigue fuera', false, ve('S-AGR', 'Dir-A'));
// 14
function cuenta(folio, d, p, m, s) {
  return filas(d, p, m, s).filter(function (r) { return r.folio === folio; }).length;
}
Check('14 folio repetido: una sola fila sin filtros', 1, cuenta('DUP'));
Check('14 folio repetido: gana la fila con categoria', 'S-Ventas',
  filas().filter(function (r) { return r.folio === 'DUP'; })[0].categoria);
Check('14 folio repetido: una sola fila con filtro comun', 1, cuenta('DUP', 'Dir-A'));

console.log('');
console.log(fallos === 0 ? 'TODO OK' : fallos + ' FALLAS');
process.exit(fallos === 0 ? 0 : 1);
