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

// 3) Año: 1-ene hasta el ultimo mes cerrado, nunca el mes en curso.
function anio(y, m, d, sel) {
  var r = P('anio', hoy(y, m, d), sel);
  return r.error ? 'ERROR' : r.params.fechaInicio + '..' + r.params.fechaFin;
}
Check('3 año 2026, hoy 2026-10-08', '2026-01-01..2026-09-30', anio(2026, 10, 8, '2026'));
Check('3b año 2026, hoy 2026-10-31', '2026-01-01..2026-09-30', anio(2026, 10, 31, '2026'));
Check('3c año 2026, hoy 2026-12-01', '2026-01-01..2026-11-30', anio(2026, 12, 1, '2026'));
Check('3d año 2026, hoy 2026-12-31', '2026-01-01..2026-11-30', anio(2026, 12, 31, '2026'));
Check('3e año 2025, hoy 2026-01-15 (enero: año anterior completo)', '2025-01-01..2025-12-31', anio(2026, 1, 15, '2025'));
Check('3f año 2026, hoy 2026-01-15: sin meses cerrados', 'ERROR', anio(2026, 1, 15, '2026'));
Check('3g año 2026, hoy 2026-02-01: solo enero', '2026-01-01..2026-01-31', anio(2026, 2, 1, '2026'));
Check('3h año pasado siempre completo', '2025-01-01..2025-12-31', anio(2026, 10, 8, '2025'));
Check('3i año futuro es error', 'ERROR', anio(2026, 10, 8, '2027'));
Check('3j año 2028, hoy 2028-03-31 -> febrero bisiesto', '2028-01-01..2028-02-29', anio(2028, 3, 31, '2028'));
Check('3n año 2024, hoy 2024-02-15 (bisiesto) -> solo enero', '2024-01-01..2024-01-31', anio(2024, 2, 15, '2024'));
Check('3o año 2024, hoy 2024-03-15 -> hasta el 29-feb', '2024-01-01..2024-02-29', anio(2024, 3, 15, '2024'));
// Lo que manda Año pasa las mismas reglas que el handler aplica a modo=rango
// (aaaa-mm-dd, inicio <= fin, <= 366 dias): se revalida como Rango personalizado.
[[2026, 10, 8, '2026'], [2026, 12, 1, '2026'], [2026, 1, 15, '2025'], [2024, 3, 15, '2024']].forEach(function (c) {
  var a = P('anio', hoy(c[0], c[1], c[2]), c[3]);
  var r = P('rango', hoy(c[0], c[1], c[2]), null, a.params.fechaInicio, a.params.fechaFin);
  Check('3p año ' + c[3] + ' (hoy ' + c.slice(0, 3).join('-') + ') es un modo=rango valido',
    { modo: 'rango', fechaInicio: a.params.fechaInicio, fechaFin: a.params.fechaFin, error: undefined },
    { modo: a.params.modo, fechaInicio: r.params && r.params.fechaInicio, fechaFin: r.params && r.params.fechaFin, error: r.error });
});
Check('3k fin de Año = fin de Mes pasado (año en curso)',
  P('mes', hoy(2026, 10, 8)).fin, P('anio', hoy(2026, 10, 8), '2026').fin);
Check('3l año usa modo=rango', 'rango', P('anio', hoy(2026, 10, 8), '2026').params.modo);
Check('3m año invalido', true, !!P('anio', hoy(2026, 10, 8), 'abc').error);

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
