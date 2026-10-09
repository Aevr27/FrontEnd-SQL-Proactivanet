// tools/tests/EfectividadExperienciaSmoke.js - la tarjeta "% Efectividad
// Reducción" de Experiencia con los filtros del tablero.
//
// NO forma parte del sitio. Recorta del propio experiencia.js las funciones
// de la tarjeta -diaMes, efectividadDe, tarjetaEfectividad- y las del filtro
// -pasaFiltroGlobal, currentCats- y las corre sobre un payload armado a mano.
// Con un argumento, tambien sobre lo que devolvio
// EfectividadExperienciaSmoke.cs contra la base de prueba del 60.
//
// Lo que fija:
//   - sin filtros cuenta todas las medidas, aunque su categoria no este en el
//     payload: da lo mismo que el 60;
//   - con filtro, una fila cuenta si su C1&C2 o su C1 es una de las
//     categorias de detReal (C2 + los C1 sin hijos), igual que las demas
//     tarjetas: un C2 con otro dueño que su C1 se filtra por su dueño;
//   - sin medidas en el filtro: S/D, cuantas estan en medicion y cuando se
//     mide la primera; sin calculo en la base: S/D "sin datos disponibles".
//
// Como correrla (desde la raiz del repositorio):
//   node tools/tests/EfectividadExperienciaSmoke.js [efectividad.json]
// Sin argumento no necesita base. Los numeros del caso con argumento son los
// de la base de prueba del 60 (fuera de este repositorio, como el 60).
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
// Una constante de una sola linea, leida del archivo y no copiada.
function constante(nombre) {
  var m = new RegExp('\\nconst ' + nombre + '\\s*=[^\\n]*').exec(fuente);
  if (!m) { console.log('FAIL  const ' + nombre + ' no esta en experiencia.js'); process.exit(1); }
  return m[0] + '\n';
}

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

// La tarjeta ya no es la fija, y recibe el mismo detReal que las demas.
var kpis = recortar('renderKPIs');
Check('renderKPIs usa la tarjeta calculada', true, kpis.indexOf('tarjetaEfectividad(detReal)') >= 0);
Check('la tarjeta fija S/D ya no esta', false, /Efectividad Reducci[^']*',v:'S\/D'/.test(kpis));
var DETREAL = "const detReal=det.filter(c=>c.nivel==='C2' || !c1conHijos.has(c.categoria));";
Check('detReal se arma como lo replica esta prueba', true, kpis.indexOf(DETREAL) >= 0);

var codigo =
  'var fDir="", fPO="", fMgr="", fSO="";\n' +
  constante('FMT') + constante('PCT') + constante('SEM') + constante('fdate') + constante('MES_CORTO') +
  recortar('pasaFiltroGlobal') + recortar('currentCats') +
  recortar('diaMes') + recortar('efectividadDe') + recortar('tarjetaEfectividad') +
  '\nreturn { tarjeta: function (d) { fDir = d || "";' +
  '  const det = currentCats();' +
  "  const c1conHijos=new Set(det.filter(c=>c.nivel==='C2').map(c=>c.categoria.split('/')[1]));\n" +
  DETREAL + '\n' +
  '  return tarjetaEfectividad(detReal); },' +
  ' detalle: function (d) { fDir = d || ""; return efectividadDe([]); } };';

function tablero(P) { return (new Function('P', codigo))(P); }

function cat(categoria, nivel, director) { return { categoria: categoria, nivel: nivel, director: director }; }
function fila(folio, c1, c1c2, medida, comp, logro, desde) {
  return { folio: folio, categoria: c1c2 + '/hoja', c1: c1, c1c2: c1c2, medida: medida,
           comp: comp, logro: logro, se_mide_desde: desde || null };
}

var P = {
  categorias: [
    cat('A', 'C1', 'D1'), cat('/A/Uno', 'C2', 'D1'),
    cat('B', 'C1', 'D2'), cat('/B/Uno', 'C2', 'D2'), cat('/B/Dos', 'C2', 'D3'),
    cat('C', 'C1', 'D4'), cat('/C/Uno', 'C2', 'D4'), cat('/C/Dos', 'C2', 'D4'),
    cat('E', 'C1', 'D5')
  ],
  efectividad: {
    calculado: '2026-10-08',
    filas: [
      fila('F1', 'A', '/A/Uno', true, 10, 9),
      fila('F2', 'B', '/B/Uno', true, 20, 5),
      fila('F2', 'B', '/B/Dos', true, 10, 10),
      fila('F3', 'C', '/C/Uno', false, 3, 0, '2026-11-06'),
      fila('F4', 'C', '/C/Dos', false, 2, 0, '2026-10-20'),
      fila('F5', 'E', '/E/X', true, 4, 4),
      fila('F6', 'Z', '/Z/Q', true, 10, 0)       // su categoria no esta en el payload
    ]
  }
};
var t = tablero(P);
function ver(d) { var c = t.tarjeta(d); return [c.v, c.s, c.f].join(' | '); }

Check('sin filtros: todas las medidas, 28 de 54 = 52%, rojo',
  '52% | r | 4 medidas · 2 en medición · al 08/10', ver(''));
Check('D1: solo /A/Uno, 9 de 10 = 90%, verde',
  '90% | v | 1 medida · 0 en medición · al 08/10', ver('D1'));
Check('D2: su C1 tiene hijos, cuenta /B/Uno y no /B/Dos (otro dueño): 25%',
  '25% | r | 1 medida · 0 en medición · al 08/10', ver('D2'));
Check('D3: dueño solo de /B/Dos, sin su C1: 100%',
  '100% | v | 1 medida · 0 en medición · al 08/10', ver('D3'));
Check('D4: solo en medicion: S/D, cuantas y cuando la primera',
  'S/D |  | 2 en medición, la primera el 20-oct · al 08/10', ver('D4'));
Check('D5: un C1 sin hijos cuenta las de toda su rama',
  '100% | v | 1 medida · 0 en medición · al 08/10', ver('D5'));
Check('un filtro sin nada: S/D sin iniciativas medidas',
  'S/D |  | sin iniciativas medidas · al 08/10', ver('nadie'));

var vacio = tablero({ categorias: P.categorias, efectividad: null });
Check('sin calculo en la base: S/D como antes',
  'S/D |  | sin datos disponibles', [vacio.tarjeta('').v, vacio.tarjeta('').s, vacio.tarjeta('').f].join(' | '));

// Datos que no sirven: nunca un porcentaje inventado.
var malas = tablero({ categorias: P.categorias, efectividad: { calculado: '2026-10-08', filas: 'x' } });
Check('filas que no son lista: S/D sin datos disponibles',
  'S/D |  | sin datos disponibles', [malas.tarjeta('').v, malas.tarjeta('').s, malas.tarjeta('').f].join(' | '));
var sinComp = tablero({ categorias: P.categorias, efectividad: { calculado: null,
  filas: [fila('F1', 'A', '/A/Uno', true, 0, 0)] } });
Check('compromiso total 0: S/D, sin dividir entre cero ni fecha de calculo',
  'S/D |  | sin iniciativas medidas', [sinComp.tarjeta('').v, sinComp.tarjeta('').s, sinComp.tarjeta('').f].join(' | '));

if (process.argv[2]) {
  var real = JSON.parse(fs.readFileSync(process.argv[2], 'utf8').replace(/^﻿/, ''));
  var tr = tablero({ categorias: [], efectividad: real });
  var e = tr.detalle('');
  Check('con lo que leyo el C# de la base del 60: 78.66 de 142.00, 10 medidas, 2 en medicion',
    '142.00 78.66 10 2', [e.comp.toFixed(2), e.logro.toFixed(2), e.medidas, e.enMedicion].join(' '));
  Check('y la tarjeta dice 55%, rojo', '55% r', tr.tarjeta('').v + ' ' + tr.tarjeta('').s);
}

console.log(fallos === 0 ? 'TODO BIEN' : fallos + ' FALLA(S)');
process.exit(fallos === 0 ? 0 : 1);
