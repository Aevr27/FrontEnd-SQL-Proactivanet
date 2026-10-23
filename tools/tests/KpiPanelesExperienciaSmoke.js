// tools/tests/KpiPanelesExperienciaSmoke.js - las dos tarjetas de Experiencia
// que abren su panel (experiencia/experiencia.js, PANEL_KPI):
//
//   R) "Iniciativas Retrasadas" cuenta lo mismo que lista el panel pVen
//      (filasBaseVen): la regla de renderKPIs y la del panel, recortadas del
//      propio archivo, sobre el mismo arbol (folios repetidos, C1 con y sin
//      C2, estados inactivos, agrupadores fuera de AGR);
//   P) mostrarPanel: abrir el panel de la tarjeta elegida la conserva; abrir
//      otro (pestaña a mano o irAActivasPorEstado) la quita y repinta las
//      tarjetas una vez;
//   T) la plantilla: solo esas dos tarjetas llevan boton, con aria-pressed;
//   L) "Limpiar" (#btnReset), recortado del archivo: quita la tarjeta
//      elegida y las tarjetas se repintan sin marca (aria-pressed="false");
//      el panel abierto se queda; tambien tras abrir otro panel a mano y
//      elegir otra tarjeta. Lo que ya borraba (dueños, graficas, tipo) lo
//      sigue borrando.
//
// NO forma parte del sitio. Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\KpiPanelesExperienciaSmoke.js   # PASS/FAIL, sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var fuente = fs.readFileSync(path.join(raiz, 'experiencia', 'experiencia.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}
function recortar(nombre) {
  var ini = fuente.indexOf('\nfunction ' + nombre + '(');
  if (ini < 0) { console.log('FAIL  ' + nombre + ' no esta en experiencia.js'); process.exit(1); }
  return fuente.slice(ini, fuente.indexOf('\n}\n', ini) + 3);
}
function entre(desde, hasta) {
  var ini = fuente.indexOf(desde), fin = fuente.indexOf(hasta, ini);
  if (ini < 0 || fin < 0) { console.log('FAIL  ' + desde + ' no esta en experiencia.js'); process.exit(1); }
  return fuente.slice(ini, fin);
}

// ---- R) la regla ----
var BLOQUE_KPI = entre('  const vistos=new Set();\n  detReal.forEach', '  const esPron');
Check('R0 renderKPIs cuenta Retrasadas con el bloque que replica esta prueba', true, /const nVen=vistos\.size;/.test(BLOQUE_KPI));
var regla = new Function('AGR', 'ESTADOS_ACTIVOS',
  recortar('filasBaseVen') +
  '\nreturn { panel: function (cats) { return filasBaseVen(cats).length; },' +
  ' kpi: function (det) {' +
  "  const c1conHijos=new Set(det.filter(c=>c.nivel==='C2').map(c=>c.categoria.split('/')[1]));\n" +
  "  const detReal=det.filter(c=>c.nivel==='C2' || !c1conHijos.has(c.categoria));\n" +
  BLOQUE_KPI + '  return nVen; } };')(['Problem', 'Mejora'], ['En Análisis', 'En Solución', 'En Monitoreo']);
function ini(folio, retrazado, agrup, estado) { return { folio: folio, retrazado: retrazado, agrup: agrup, estado: estado }; }
var cats = [
  { categoria: 'Red', nivel: 'C1', iniciativas: [ini('X9', 5, 'Problem', 'En Análisis')] },   // C1 con hijos: no cuenta
  { categoria: '/Red/LAN', nivel: 'C2', iniciativas: [ini('P1', 3, 'Problem', 'En Análisis'), ini('P2', 0, 'Problem', 'En Análisis')] },
  { categoria: '/Red/WAN', nivel: 'C2', iniciativas: [ini('P1', 3, 'Problem', 'En Análisis'), ini('P3', 1, 'Otro', 'En Solución')] },
  { categoria: '/Sap', nivel: 'C1', iniciativas: [ini('P4', 2, 'Mejora', 'En Monitoreo'), ini('P5', 2, 'Mejora', 'Cerrado')] },
];
Check('R1 KPI == filas del panel (P1 una vez, P4; fuera X9, P2, P3, P5)', [2, 2], [regla.kpi(cats), regla.panel(cats)]);
Check('R2 sin categorias: 0 y 0', [0, 0], [regla.kpi([]), regla.panel([])]);

// ---- P) mostrarPanel ----
function clases() { var s = new Set(); return { toggle: function (c, si) { if (si) s.add(c); else s.delete(c); }, has: function (c) { return s.has(c); } }; }
function nodo(atr) { var n = { classList: clases(), dataset: {} }; Object.keys(atr).forEach(function (k) { if (k === 'panel') n.dataset.panel = atr[k]; else n[k] = atr[k]; }); return n; }
var tabs = ['pDet', 'pSin', 'pVen', 'pAct'].map(function (p) { return nodo({ panel: p }); });
var paneles = ['pDet', 'pSin', 'pVen', 'pAct'].map(function (p) { return nodo({ id: p }); });
var RAIZ = { querySelectorAll: function (s) { return s === '.tab' ? tabs : paneles; } };
var ventana = {};
(new Function('window', fs.readFileSync(path.join(raiz, 'assets', 'js', 'seleccion-kpi.js'), 'utf8')))(ventana);
var repintes = 0;
var P2 = new Function('RAIZ', 'window', 'renderKPIs', 'aggCats', 'currentCats',
  entre('const PANEL_KPI=', '\nfunction mostrarPanel(') + recortar('mostrarPanel') +
  '\nreturn { sel: seleccionKpi, mostrar: mostrarPanel };')(RAIZ, ventana, function () { repintes++; }, function () {}, function () {});
function activo() { return paneles.filter(function (p) { return p.classList.has('active'); }).map(function (p) { return p.id; }); }
P2.sel.alternar('ven'); P2.mostrar('pVen');
Check('P1 tarjeta Retrasadas: pVen activo, marca intacta, sin repintar', [['pVen'], 'ven', 0], [activo(), P2.sel.clave, repintes]);
P2.mostrar('pSin');
Check('P2 otro panel a mano: quita la marca y repinta una vez', [['pSin'], '', 1], [activo(), P2.sel.clave, repintes]);
P2.mostrar('pDet');
Check('P3 sin marca: cambiar de panel no repinta', [['pDet'], 1], [activo(), repintes]);
Check('P4 la pestaña sigue al panel', ['pDet'], tabs.filter(function (t) { return t.classList.has('active'); }).map(function (t) { return t.dataset.panel; }));
Check('P5 solo sin y ven son validas', [false, true, true], [P2.sel.alternar('vol'), P2.sel.alternar('sin'), P2.sel.alternar('ven')]);
Check('P6 irAActivasPorEstado pasa por mostrarPanel', true, /mostrarPanel\('pAct'\)/.test(recortar('irAActivasPorEstado')));
Check('P7 las pestañas pasan por mostrarPanel', true, /t\.onclick=\(\)=>mostrarPanel\(t\.dataset\.panel\)/.test(fuente));

// ---- T) plantilla ----
var kp = recortar('renderKPIs');
Check('T1 solo Categorias sin Iniciativa e Iniciativas Retrasadas llevan clave', [["k:'sin'", "k:'ven'"], 2],
  [kp.match(/k:'(sin|ven)'/g), (kp.match(/,k:'/g) || []).length]);
Check('T2 boton y clases de SeleccionKpi en la plantilla', true, /sel\.clases\(c\.k\)/.test(kp) && /sel\.boton\(c\.k, c\.l\+': '\+c\.v\)/.test(kp));

// ---- L) Limpiar ----
var RESET = entre("document.getElementById('btnReset').onclick=()=>{", '\n};\n');
Check('L0 Limpiar quita la tarjeta antes de repintar', true,
  /seleccionKpi\.limpiar\(\);\s*renderAll\(\);\s*$/.test(RESET));
var vistas = [];
var estado = { fDir: 'Dir A', fPO: 'PO 1', fMgr: '', fSO: '', tipo: 'problemas' };
var limpiar = new Function('RAIZ', 'window', 'renderKPIs', 'aggCats', 'currentCats', 'estado', 'vistas',
  entre('const PANEL_KPI=', '\nfunction mostrarPanel(') + recortar('mostrarPanel') +
  'let fDir=estado.fDir, fPO=estado.fPO, fMgr=estado.fMgr, fSO=estado.fSO, tipoRegistro=estado.tipo;\n' +
  'const selDir={value:fDir}, selMgr={value:fMgr}; function fillPO(){} function fillSO(){}\n' +
  'const filtroGraf={ven:{dimVal:"x",agrup:"y",estado:"z"},act:{dimVal:"x",agrup:"",estado:""}};\n' +
  'function aplicarTipoRegistro(t){tipoRegistro=t;} function pintarTipoRegistro(){}\n' +
  // renderAll de mentira: apunta lo que pintaria cada tarjeta.
  'function renderAll(){ vistas.push({ clave: seleccionKpi.clave, sin: seleccionKpi.clases("sin") + seleccionKpi.boton("sin", "S"),' +
  ' ven: seleccionKpi.clases("ven") + seleccionKpi.boton("ven", "V"), duenos: [fDir, fPO, fMgr, fSO].join("|"),' +
  ' graf: filtroGraf.ven.dimVal + filtroGraf.ven.agrup + filtroGraf.ven.estado, tipo: tipoRegistro }); }\n' +
  'const reset=' + RESET.replace("document.getElementById('btnReset').onclick=", '') + '\n};\n' +
  'return { sel: seleccionKpi, mostrar: mostrarPanel, reset: reset };')(RAIZ, ventana, function () {}, function () {}, function () {}, estado, vistas);
function pressed(html) { var m = /aria-pressed="(true|false)"/.exec(html); return m ? m[1] : null; }
limpiar.sel.alternar('ven'); limpiar.mostrar('pVen');
limpiar.reset();
var v = vistas[vistas.length - 1];
Check('L1 Limpiar con Retrasadas elegida: sin clave, ninguna con kpi-sel, aria-pressed="false"',
  ['', false, false, 'false', 'false'], [v.clave, /kpi-sel/.test(v.sin), /kpi-sel/.test(v.ven), pressed(v.sin), pressed(v.ven)]);
Check('L1 el panel abierto se queda (pVen)', ['pVen'], activo());
Check('L1 lo que ya borraba lo sigue borrando: dueños, graficas, tipo', ['|||', '', 'todos'], [v.duenos, v.graf, v.tipo]);
limpiar.sel.alternar('ven'); limpiar.mostrar('pVen');
limpiar.mostrar('pAct');                       // a mano otro panel: ya quita la marca
limpiar.sel.alternar('sin'); limpiar.mostrar('pSin');
Check('L2a antes: otro panel a mano y luego Sin iniciativa elegida', 'sin', limpiar.sel.clave);
limpiar.reset();
v = vistas[vistas.length - 1];
Check('L2 Limpiar: sin clave y sin marca; panel pSin se queda', ['', 'false', 'false', ['pSin']],
  [v.clave, pressed(v.sin), pressed(v.ven), activo()]);
// L3: de una tarjeta a otra con el clic (reemplaza) y luego Limpiar.
limpiar.sel.alternar('sin'); limpiar.mostrar('pSin');
limpiar.sel.alternar('ven'); limpiar.mostrar('pVen');
Check('L3a antes: Retrasadas reemplazo a Sin iniciativa', 'ven', limpiar.sel.clave);
limpiar.reset();
v = vistas[vistas.length - 1];
Check('L3 Limpiar tras cambiar de tarjeta: sin clave ni marca; pVen se queda', ['', 'false', 'false', ['pVen']],
  [v.clave, pressed(v.sin), pressed(v.ven), activo()]);
// L4: Limpiar sin nada elegido: repinta igual que siempre, sin marca.
var antes = vistas.length;
limpiar.reset();
v = vistas[vistas.length - 1];
Check('L4 Limpiar sin tarjeta: repinta una vez, sin marca, mismo panel', [antes + 1, '', 'false', ['pVen']],
  [vistas.length, v.clave, pressed(v.ven), activo()]);
// L5: despues de Limpiar el clic vuelve a elegir.
limpiar.sel.alternar('sin');
Check('L5 despues de Limpiar el clic vuelve a elegir', 'sin', limpiar.sel.clave);

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
