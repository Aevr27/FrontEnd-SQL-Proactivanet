// tools/tests/PeriodoDescargaSmoke.js - prueba de humo del selector de periodo
// de "Descargar Tickets" del tablero de Experiencia.
//
// NO forma parte del sitio. Ejecuta el bloque PERIODO DESCARGA REAL, recortado
// de experiencia/experiencia.js entre sus dos marcadores, con distintos "hoy",
// y comprueba los parametros exactos que viajan a
// handlers/experiencia_exportar.ashx y los dias que debe cubrir el libro.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\PeriodoDescargaSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');

function cargarBloque() {
  var fuente = fs.readFileSync(path.join(raiz, 'experiencia', 'experiencia.js'), 'utf8');
  var ini = fuente.indexOf('/* === PERIODO DESCARGA (inicio) ===');
  var fin = fuente.indexOf('/* === PERIODO DESCARGA (fin) === */');
  if (ini < 0 || fin < 0) throw new Error('no se encontraron los marcadores PERIODO DESCARGA en experiencia/experiencia.js');
  return (new Function(fuente.slice(ini, fin) +
    '\nreturn {periodoDescarga: periodoDescarga, fueraDePeriodo: fueraDePeriodo};'))();
}

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

var B = cargarBloque();
var P = B.periodoDescarga;
function hoy(y, m, d) { return new Date(y, m - 1, d, 15, 30); }
function sinEtiqueta(r) { return { params: r.params, inicio: r.inicio, fin: r.fin }; }

// 1) Hoy 8-oct -> septiembre completo.
Check('1 mes pasado, hoy 2026-10-08',
  { params: { modo: 'mes', anio: '2026', mes: '9' }, inicio: '2026-09-01', fin: '2026-09-30' },
  sinEtiqueta(P('mes', hoy(2026, 10, 8))));
Check('1 etiqueta', 'Septiembre 2026', P('mes', hoy(2026, 10, 8)).etiqueta);

// 2) Hoy 31-oct -> sigue siendo septiembre (sin desbordar a "31-sep").
Check('2 mes pasado, hoy 2026-10-31',
  { params: { modo: 'mes', anio: '2026', mes: '9' }, inicio: '2026-09-01', fin: '2026-09-30' },
  sinEtiqueta(P('mes', hoy(2026, 10, 31))));
Check('2b mes pasado, hoy 2026-10-01 (primer dia)',
  { params: { modo: 'mes', anio: '2026', mes: '9' }, inicio: '2026-09-01', fin: '2026-09-30' },
  sinEtiqueta(P('mes', hoy(2026, 10, 1))));
Check('2c mes pasado en enero -> diciembre del año anterior',
  { params: { modo: 'mes', anio: '2025', mes: '12' }, inicio: '2025-12-01', fin: '2025-12-31' },
  sinEtiqueta(P('mes', hoy(2026, 1, 15))));
Check('2d mes pasado, hoy 2028-03-31 -> febrero bisiesto',
  { params: { modo: 'mes', anio: '2028', mes: '2' }, inicio: '2028-02-01', fin: '2028-02-29' },
  sinEtiqueta(P('mes', hoy(2028, 3, 31))));

// 3) Año 2026 -> 1-ene..31-dic, no 12 meses moviles.
Check('3 año 2026',
  { params: { modo: 'rango', fechaInicio: '2026-01-01', fechaFin: '2026-12-31' }, inicio: '2026-01-01', fin: '2026-12-31' },
  sinEtiqueta(P('anio', hoy(2026, 10, 8), '2026')));
Check('3b año no depende de hoy', P('anio', hoy(2026, 10, 8), '2025').params,
  P('anio', hoy(2026, 3, 2), '2025').params);
Check('3c año invalido', true, !!P('anio', hoy(2026, 10, 8), 'abc').error);

// 4) Rango personalizado: exactamente lo elegido.
Check('4 rango 15-ago..20-sep',
  { params: { modo: 'rango', fechaInicio: '2026-08-15', fechaFin: '2026-09-20' }, inicio: '2026-08-15', fin: '2026-09-20' },
  sinEtiqueta(P('rango', hoy(2026, 10, 8), null, '2026-08-15', '2026-09-20')));
Check('4b un solo dia vale', '2026-09-20',
  P('rango', hoy(2026, 10, 8), null, '2026-09-20', '2026-09-20').params.fechaFin);
Check('4c inicio > fin es error', true, !!P('rango', hoy(2026, 10, 8), null, '2026-09-21', '2026-09-20').error);
Check('4d fecha vacia es error', true, !!P('rango', hoy(2026, 10, 8), null, '', '2026-09-20').error);
Check('4e 366 dias (2028 bisiesto) vale', undefined,
  P('rango', hoy(2026, 10, 8), null, '2028-01-01', '2028-12-31').error);
Check('4f 367 dias es error', true, !!P('rango', hoy(2026, 10, 8), null, '2025-01-01', '2026-01-02').error);

// Red de seguridad del libro: bordes incluidos, un segundo fuera no.
var tickets = [
  { fecha_registro: '2026-08-15 00:00:00' },
  { fecha_registro: '2026-09-20 23:59:59' },
  { fecha_registro: '2026-08-14 23:59:59' },
  { fecha_registro: '2026-09-21 00:00:00' },
];
Check('5 fueraDePeriodo: solo los dos de fuera', 2, B.fueraDePeriodo(tickets, '2026-08-15', '2026-09-20'));
Check('5b sin fecha cuenta como fuera', 1, B.fueraDePeriodo([{}], '2026-08-15', '2026-09-20'));

console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODO OK');
process.exit(fallos ? 1 : 0);
