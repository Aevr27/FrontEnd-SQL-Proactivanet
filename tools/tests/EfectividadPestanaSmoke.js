// tools/tests/EfectividadPestanaSmoke.js - las cuentas de la pestaña
// "Efectividad de iniciativas" (EfectividadCalc, efectividad/efectividad.js).
//
// NO forma parte del sitio. Lo que fija:
//   - con los mismos filtros de dueño da lo mismo que la tarjeta
//     "% Efectividad Reducción" de Experiencia: se recortan del propio
//     experiencia.js pasaFiltroGlobal, currentCats y efectividadDe, y el
//     detReal de renderKPIs, y se comparan;
//   - la calificacion (efectiva desde 90%, parcial, sin baja), el rebote, la
//     meta, el calendario de las en medicion y los grupos de las que no se
//     califican;
//   - con los dos JSON que escribe EfectividadPestanaSmoke.cs contra la base
//     del 60: sin filtros, las tarjetas dan lo mismo que la corrida, y con
//     CADA dueño del catalogo, lo mismo que la tarjeta de Experiencia.
//
// Como correrla (desde sitio/):
//   node tools/tests/EfectividadPestanaSmoke.js [pestana.json experiencia.json]
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var Calc = require(path.join(raiz, 'efectividad', 'efectividad.js'));
var fuente = fs.readFileSync(path.join(raiz, 'experiencia', 'experiencia.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

function recortar(nombre) {
  var ini = fuente.indexOf('\nfunction ' + nombre + '(');
  if (ini < 0) { console.log('FAIL  ' + nombre + ' no esta en experiencia.js'); process.exit(1); }
  var fin = fuente.indexOf('\n}\n', ini);
  return fuente.slice(ini, fin + 3);
}

// ---- la tarjeta de Experiencia, tal cual ----------------------------------
var DETREAL = "const detReal=det.filter(c=>c.nivel==='C2' || !c1conHijos.has(c.categoria));";
Check('renderKPIs arma detReal como lo replica esta prueba', true, recortar('renderKPIs').indexOf(DETREAL) >= 0);
Check('renderKPIs le pasa detReal a la tarjeta', true, recortar('renderKPIs').indexOf('tarjetaEfectividad(detReal)') >= 0);
Check('renderAll llama renderKPIs(agg, cats) con cats = currentCats()', true,
  /const cats=currentCats\(\);[\s\S]*renderKPIs\(agg, cats\)/.test(recortar('renderAll')));

var codigo =
  'var fDir="", fPO="", fMgr="", fSO="";\n' +
  recortar('pasaFiltroGlobal') + recortar('currentCats') + recortar('efectividadDe') +
  '\nreturn function (f) { fDir = f.dir || ""; fPO = f.po || ""; fMgr = f.mgr || ""; fSO = f.so || "";' +
  '  const det = currentCats();' +
  "  const c1conHijos=new Set(det.filter(c=>c.nivel==='C2').map(c=>c.categoria.split('/')[1]));\n" +
  DETREAL + '\n  return efectividadDe(detReal); };';
function tarjetaDe(P) { return (new Function('P', codigo))(P); }

// La tarjeta lee de P.efectividad.filas solo las medidas y las en medicion.
function comoExperiencia(datos) {
  return {
    categorias: datos.categorias,
    efectividad: { calculado: '2026-10-14', filas: datos.filas.filter(function (r) { return r.orden === 14 || r.orden === 15; })
      .map(function (r) { return { folio: r.folio, categoria: r.categoria, c1: r.c1, c1c2: r.c1c2, medida: r.orden === 15,
                                   comp: r.comp, logro: r.logro, se_mide_desde: r.se_mide_desde }; }) },
  };
}

function igualQueTarjeta(nombre, datos, P, f) {
  var t = tarjetaDe(P)(f);
  var r = Calc.resumen(Calc.filtrar(datos, f));
  var a = [t.comp.toFixed(4), t.logro.toFixed(4), t.kpi == null ? 'null' : t.kpi.toFixed(6), t.medidas, t.enMedicion, t.primera].join(' ');
  var b = [r.comp.toFixed(4), r.logro.toFixed(4), r.kpi == null ? 'null' : r.kpi.toFixed(6), r.medidas, r.en_medicion, r.primera].join(' ');
  Check(nombre, a, b);
  return t;
}

// ---- datos armados a mano --------------------------------------------------
function cat(categoria, nivel, d) {
  return { categoria: categoria, nivel: nivel, director: d[0], po: d[1], so: d[2], manager: d[3] };
}
var D1 = ['Dir 1', 'PO 1', 'SO 1', 'Mgr 1'], D2 = ['Dir 2', 'PO 2', 'SO 2', 'Mgr 1'], D3 = ['Dir 2', 'PO 3', 'SO 3', 'Mgr 2'];
function fila(folio, c1c2, orden, o) {
  o = o || {};
  var r = { folio: folio, prefijo: folio.slice(0, 3), estado: o.estado || 'Cerrado', categoria: c1c2 + '/hoja',
            categoria_excel: c1c2 + '/hoja', c1: c1c2.split('/')[1], c1c2: c1c2, orden: orden,
            motivo: o.motivo || (orden === 15 ? 'Medida' : orden === 14 ? 'En medicion' : 'Otro'),
            comp: o.comp == null ? null : o.comp, logro: o.logro == null ? null : o.logro,
            asignada: o.asignada == null ? (o.logro == null ? null : o.logro) : o.asignada,
            evitados: o.evitados || 0, reduccion_hoy: o.hoy == null ? null : o.hoy, evalua_rebote: !!o.rebote,
            se_mide_desde: o.desde || null, titulo: o.titulo || null, parte: o.parte == null ? 1 : o.parte,
            esperado_mes: o.esperado == null ? null : o.esperado, base_mes: o.base == null ? null : o.base };
  return r;
}
var datos = {
  categorias: [
    cat('A', 'C1', D1), cat('/A/Uno', 'C2', D1),
    cat('B', 'C1', D1), cat('/B/Uno', 'C2', D1), cat('/B/Dos', 'C2', D2),   // un C2 con otro dueño que su C1
    cat('C', 'C1', D3), cat('/C/Uno', 'C2', D3),
    cat('E', 'C1', D2),                                                      // C1 sin hijos
  ],
  filas: [
    fila('PRB 1', '/A/Uno', 15, { comp: 10, logro: 9, evitados: 30, titulo: 'Exactamente 90%' }),
    fila('PRB 2', '/B/Uno', 15, { comp: 20, logro: 5, asignada: 5, evitados: 12, rebote: true, hoy: -1 }),
    fila('PRB 2', '/B/Dos', 15, { comp: 10, logro: 10, asignada: 10, evitados: 20, rebote: true, hoy: 4 }),
    fila('ADO 3', '/C/Uno', 14, { comp: 3, desde: '2026-11-06' }),
    fila('ADO 4', '/C/Uno', 14, { comp: 2, desde: '2026-10-20' }),
    fila('ADO 5', '/C/Uno', 14, { comp: 1, desde: '2026-11-30' }),
    fila('SOR 6', '/E/X', 15, { comp: 4, logro: 0, asignada: -3 }),
    fila('SOR 7', '/E/Y', 15, { comp: 10, logro: 8.99 }),
    fila('PRB 8', '/Z/Q', 15, { comp: 10, logro: 0 }),                      // su categoria no esta en el tablero
    fila('PRB 9', '/A/Uno', 7, { motivo: 'Sin % de disminucion' }),
    fila('PRB 9', '/A/Dos', 5, { motivo: 'Sin categoria (N/A o vacia)' }),
    fila('PRB 10', '/B/Uno', 13, { motivo: 'Sin base: ningun ticket antes de crearse' }),
    fila('PRB 11', '/C/Uno', 1, { motivo: 'Aun no implementada (En Analisis / En Solucion)', estado: 'En Análisis' }),
    fila('PRB 2', '/B/Tres', 7, { motivo: 'Sin % de disminucion' }),        // una medida con otra categoria sin %
  ],
};
var P = comoExperiencia(datos);

console.log('-- igual que la tarjeta de Experiencia');
igualQueTarjeta('sin filtros', datos, P, {});
igualQueTarjeta('Director 1', datos, P, { dir: 'Dir 1' });
igualQueTarjeta('Director 2 (C2 de otro dueño y un C1 sin hijos)', datos, P, { dir: 'Dir 2' });
igualQueTarjeta('PO 2: solo /B/Dos, sin su C1', datos, P, { po: 'PO 2' });
igualQueTarjeta('Manager 1 (dos SO)', datos, P, { mgr: 'Mgr 1' });
igualQueTarjeta('Manager 2: solo en medicion', datos, P, { mgr: 'Mgr 2' });
igualQueTarjeta('SO 3 y Director 2 a la vez', datos, P, { dir: 'Dir 2', so: 'SO 3' });
igualQueTarjeta('un dueño sin nada', datos, P, { dir: 'Nadie' });

console.log('-- calificacion');
var med = Calc.medidas(Calc.filtrar(datos, {}));
function de(folio) { return med.filter(function (i) { return i.folio === folio; })[0]; }
Check('90% exacto es efectiva', 'efectiva', de('PRB 1').calificacion);
Check('89.9% es parcial', 'parcial', de('SOR 7').calificacion);
Check('0% es sin baja', 'sin_baja', de('PRB 8').calificacion);
Check('una iniciativa con dos categorias suma las dos: 15 de 30', '30 15 0.5', [de('PRB 2').comp, de('PRB 2').logro, de('PRB 2').efectividad].join(' '));
Check('peor que lo esperado: empeoro', true, de('SOR 6').empeoro);
Check('rebote: ya cumple 180 dias, bajo y hoy no esta por debajo de lo esperado (-1 + 4 = 3 > 0: no)', false, de('PRB 2').rebote);
var r = Calc.resumen(Calc.filtrar(datos, {}));
Check('cuentas por calificacion: 1 efectiva, 2 parciales, 2 sin baja', '1 2 2', [r.efectivas, r.parciales, r.sin_baja].join(' '));
Check('rebote: 1 evaluable, 0 con rebote', '1 0', [r.evaluables_rebote, r.con_rebote].join(' '));
var conRebote = JSON.parse(JSON.stringify(datos));
conRebote.filas.forEach(function (x) { if (x.folio === 'PRB 2' && x.c1c2 === '/B/Dos') x.reduccion_hoy = -2; });
Check('con la reduccion de hoy en -3 si rebota', 1, Calc.resumen(Calc.filtrar(conRebote, {})).con_rebote);
Check('evitados: suma de las medidas', 62, r.evitados);
var sor = Calc.resumen(Calc.filtrar(datos, { tipo: 'SOR' }));
Check('el tipo filtra encima: solo SOR, 8.99 de 14 en 2 medidas', '14 8.99 2', [sor.comp, sor.logro, sor.medidas].join(' '));
var sorD2 = Calc.resumen(Calc.filtrar(datos, { tipo: 'SOR', dir: 'Dir 2' }));
Check('tipo y dueño a la vez (AND)', '14 2', [sorD2.comp, sorD2.medidas].join(' '));

console.log('-- en medicion y las que no se califican');
var cal = Calc.calendario(Calc.filtrar(datos, {}));
Check('calendario por mes: oct 1, nov 2', '2026-10:1 2026-11:2', cal.map(function (m) { return m.mes + ':' + m.iniciativas; }).join(' '));
Check('la primera en medirse', '2026-10-20', r.primera);
Check('en medicion, de la mas proxima a la mas lejana', 'ADO 4 ADO 3 ADO 5',
  Calc.enMedicion(Calc.filtrar(datos, {})).map(function (i) { return i.folio; }).join(' '));
var nc = Calc.noCalificables(Calc.filtrar(datos, {}));
function grupo(id) { return nc.filter(function (g) { return g.id === id; })[0]; }
Check('corregir en el Excel: PRB 9 (dos motivos) y PRB 2 (/B/Tres sin %)', '2 2', [grupo('corregir').folios.size, grupo('corregir').motivos.length].join(' '));
Check('sin historia: PRB 10', 1, grupo('historia').folios.size);
Check('por regla: PRB 11', 1, grupo('regla').folios.size);
Check('el motivo con mas iniciativas primero', 'Sin % de disminucion', grupo('corregir').motivos[0].motivo);
Check('no calificables y por corregir', '4 2', [r.no_calificables, r.por_corregir].join(' '));
Check('cada Orden del 60 cae en un grupo (o es medida / en medicion)', '',
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13].filter(function (o) { return !Calc.grupoDe(o); }).join(','));

console.log('-- la meta de la boleta');
Check('meta = esperado - compromiso / parte', 10, Calc.meta({ esperado_mes: 20, comp: 5, parte: 0.5 }));
Check('nunca menos de 0', 0, Calc.meta({ esperado_mes: 2, comp: 5, parte: 1 }));
Check('sin parte no hay meta', 'null', String(Calc.meta({ esperado_mes: 20, comp: 5, parte: 0 })));
Check('el semaforo es el de Experiencia (SEM)', true,
  /const SEM = v => v>=0\.9\?'v':\(v>=0\.7\?'a':'r'\);/.test(fuente) && Calc.sem(0.9) === 'v' && Calc.sem(0.7) === 'a' && Calc.sem(0.69) === 'r');

// ---- contra la base del 60 ---------------------------------------------------
if (process.argv[2] && process.argv[3]) {
  console.log('-- con lo que leyo el C# de la base del 60');
  var leer = function (p) { return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, '')); };
  var real = leer(process.argv[2]);
  var exp = leer(process.argv[3]);
  var c = real.corrida;
  var t = Calc.resumen(Calc.filtrar(real, {}));
  Check('sin filtros, lo mismo que la corrida: compromiso y logro', c.compromiso.toFixed(2) + ' ' + c.logro.toFixed(2),
    t.comp.toFixed(2) + ' ' + t.logro.toFixed(2));
  Check('el %', c.efectividad.toFixed(4), t.kpi.toFixed(4));
  Check('medidas, efectivas, evaluables de rebote y con rebote',
    [c.iniciativas_medidas, c.iniciativas_efectivas, c.evaluables_rebote, c.con_rebote].join(' '),
    [t.medidas, t.efectivas, t.evaluables_rebote, t.con_rebote].join(' '));
  Check('tickets evitados', c.tickets_evitados.toFixed(1), t.evitados.toFixed(1));
  Check('en medicion y la primera', c.iniciativas_en_medicion + ' ' + c.primera_en_medirse, t.en_medicion + ' ' + t.primera);
  Check('todas las filas de la corrida', c.filas, real.filas.length);

  // Cada dueño del catalogo, solo y combinado, contra la tarjeta.
  var casos = [{}];
  var valores = function (campo) {
    var s = new Set();
    exp.categorias.forEach(function (x) { if (x[campo]) s.add(x[campo]); });
    return Array.from(s).sort();
  };
  valores('director').forEach(function (v) { casos.push({ dir: v }); });
  valores('po').forEach(function (v) { casos.push({ po: v }); });
  valores('manager').forEach(function (v) { casos.push({ mgr: v }); });
  valores('so').forEach(function (v) { casos.push({ so: v }); });
  valores('director').forEach(function (d) { valores('manager').forEach(function (m) { casos.push({ dir: d, mgr: m }); }); });
  var tarjetaReal = tarjetaDe(exp);
  var distintos = [];
  casos.forEach(function (f) {
    var a = tarjetaReal(f), b = Calc.resumen(Calc.filtrar(real, f));
    var x = [a.comp.toFixed(4), a.logro.toFixed(4), a.medidas, a.enMedicion, a.primera].join(' ');
    var y = [b.comp.toFixed(4), b.logro.toFixed(4), b.medidas, b.en_medicion, b.primera].join(' ');
    if (x !== y) distintos.push(JSON.stringify(f) + ' tarjeta=' + x + ' pestana=' + y);
  });
  Check('con cada uno de los ' + casos.length + ' filtros de dueño da lo mismo que la tarjeta', '', distintos.join(' | '));
  Check('y los filtros si separan algo (no todos dan lo mismo que sin filtros)', true,
    casos.some(function (f) { return Calc.resumen(Calc.filtrar(real, f)).comp !== t.comp; }));
}

console.log(fallos === 0 ? 'TODO BIEN' : fallos + ' FALLA(S)');
process.exit(fallos === 0 ? 0 : 1);
