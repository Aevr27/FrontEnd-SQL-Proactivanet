// tools/tests/TicketsReduceRedondeoSmoke.js - "Tickets a reducir" en el
// navegador (2026-11-11). REGLA DEL NEGOCIO: cada iniciativa redondea HACIA
// ARRIBA por separado, CEILING(volumen x %): un ticket fraccionario es un
// ticket que hay que atender (7 x 99% = 6.93 -> 7). Es la regla de sql/84
// (adm.usp_GestionAdmin_TicketsReduce) y sql/85 (foto diaria).
//
// Lee el codigo REAL (sin copiarlo):
//   T1 ticketsDe              admin/iniciativas.js      (Nueva solicitud, Solicitudes)
//   T2 MetaCategoria.tickets  admin/iniciativa-admin.js (Crear / Modificar ADM)
//   T3 entradas vacias / invalidas: volumen null, % null, negativo, > 100.
//   T4 barrido: volumen 0..2000 x cada % de 0.00 a 100.00 (paso 0.01), las
//      dos rutas = CEILING exacto en enteros; nunca mas que el volumen; lo
//      exacto no sube.
//   T5 tickets -> % (ALGORITMO A, el que ya estaba): la proporcion exacta
//      n / vol redondeada hacia ABAJO al paso (0.01% o 1%), si con CEILING da
//      esos n; si no, el paso siguiente. Propiedades: nunca pasa de 100%,
//      siempre da al menos n, da EXACTAMENTE n cuando algun % de ese paso lo
//      da, y en ese caso no "se come" la proporcion (15 de 30 = 50%, no
//      46.67%). pctDeTickets (iniciativas.js) = MetaCategoria.pctEntero.
//   T6 tablero (experiencia/experiencia.js conDeCatV2 / sinDeCatV2): lo
//      cubierto se topa al volumen: 7 x 99% = 7 cubiertos y 0 sin cubrir;
//      9 sobre 7 = 7 y 0.
//
// No toca la base ni el servidor. Sale 1 si algo falla.
//   node tools\tests\TicketsReduceRedondeoSmoke.js
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(r) { return fs.readFileSync(path.join(raiz, r), 'utf8'); }
var fallos = 0, pasaron = 0;
function Check(titulo, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e !== o) fallos++; else pasaron++;
  console.log((e === o ? 'PASS  ' : 'FAIL  ') + titulo + (e === o ? '' : '  esperado=' + e + '  obtenido=' + o));
}
function Extraer(src, inicio) {
  var i = src.indexOf(inicio), j = src.indexOf('{', i), n = 0;
  if (i < 0) throw new Error('falta ' + inicio);
  for (; j < src.length; j++) { if (src[j] === '{') n++; else if (src[j] === '}' && --n === 0) break; }
  return src.slice(i, j + 1) + (src[j + 1] === ';' ? ';' : '');
}

var fuenteIni = leer('admin/iniciativas.js');
var ini = (new Function(Extraer(fuenteIni, 'var VALIDAR = {') + '\n' + Extraer(fuenteIni, 'function ticketsDe(') + '\n' +
  Extraer(fuenteIni, 'function pctDeTickets(') + '\nreturn { ticketsDe: ticketsDe, pctDeTickets: pctDeTickets };'))();
var fuenteAdm = leer('admin/iniciativa-admin.js');
var MetaCategoria = (new Function(Extraer(fuenteAdm, 'function vacio(') + '\n' + Extraer(fuenteAdm, 'var FORMATO = {') + '\n' +
  Extraer(fuenteAdm, 'var MetaCategoria = {') + '\nreturn MetaCategoria;'))();
var fuenteExp = leer('experiencia/experiencia.js');
var tablero = (new Function('var modoTiempo = "slot", P = { mes_actual: 11 };\n' + Extraer(fuenteExp, 'function volCatV2(') + '\n' +
  Extraer(fuenteExp, 'function conDeCatV2(') + '\n' + Extraer(fuenteExp, 'function sinDeCatV2(') +
  '\nreturn { con: conDeCatV2, sin: sinDeCatV2 };'))();

// CEILING exacto en enteros: vol x centesimas de % / 10000, hacia arriba.
function ceiling(vol, c) { var x = vol * c; return x % 10000 === 0 ? x / 10000 : Math.floor(x / 10000) + 1; }

// T1 / T2: la tabla.
var EJEMPLOS = [
  [7, '99', 7], [7, '9.46', 1], [418, '10', 42], [1247, '12.5', 156], [30, '50', 15],
  [120, '20', 24], [7, '5', 1], [7, '0', 0], [0, '50', 0], [7, '100', 7],
  [7, '7', 1], [7, '7.15', 1], [93, '50', 47], [418, '12.5', 53], [1247, '33.33', 416], [134, '0.01', 1]
];
var esperado = EJEMPLOS.map(function (e) { return e[2]; });
Check('T1 ticketsDe (admin/iniciativas.js) = CEILING: 7x99%=7, 7x9.46%=1, 418x10%=42, 1247x12.5%=156, 30x50%=15, 120x20%=24, 7x5%=1, 7x0%=0, 0x50%=0, 7x100%=7 ...',
  esperado, EJEMPLOS.map(function (e) { return ini.ticketsDe(e[0], e[1]); }));
Check('T2 MetaCategoria.tickets (admin/iniciativa-admin.js) = CEILING en los mismos ejemplos',
  esperado, EJEMPLOS.map(function (e) { return MetaCategoria.tickets(e[0], e[1]); }));

// T3: entradas que el contrato rechaza (null, no un numero inventado).
var MALAS = [[null, '50'], [undefined, '50'], [7.5, '50'], [-1, '50'], [7, null], [7, ''], [7, '-5'], [7, '-0.01'],
             [7, '100.01'], [7, '101'], [7, '12.345'], [7, 'x']];
Check('T3 ticketsDe: volumen null/no entero/negativo, % vacio, negativo, > 100 o con 3 decimales -> null',
  MALAS.map(function () { return null; }), MALAS.map(function (m) { return ini.ticketsDe(m[0], m[1]); }));
Check('T3 MetaCategoria.tickets: lo mismo -> null',
  MALAS.map(function () { return null; }), MALAS.map(function (m) { return MetaCategoria.tickets(m[0], m[1]); }));

// T4: barrido completo.
var PCTS = []; for (var c = 0; c <= 10000; c++) PCTS.push(String(c / 100));
var difIni = [], difAdm = [], pasa = [], sube = [], revisadas = 0;
for (var vol = 0; vol <= 2000; vol++) {
  for (c = 0; c <= 10000; c++) {
    var e = ceiling(vol, c), a = ini.ticketsDe(vol, PCTS[c]), b = MetaCategoria.tickets(vol, PCTS[c]);
    revisadas++;
    if (a !== e && difIni.length < 5) difIni.push([vol, PCTS[c], a, e]);
    if (b !== e && difAdm.length < 5) difAdm.push([vol, PCTS[c], b, e]);
    if (a > vol && pasa.length < 5) pasa.push([vol, PCTS[c], a]);
    if ((vol * c) % 10000 === 0 && a !== vol * c / 10000 && sube.length < 5) sube.push([vol, PCTS[c], a]);
  }
}
Check('T4 barrido 0..2000 x 0.00..100.00% (' + revisadas + ' pares): ticketsDe = CEILING exacto', [], difIni);
Check('T4 barrido: MetaCategoria.tickets = CEILING exacto (y por tanto = ticketsDe)', [], difAdm);
Check('T4 barrido: ningun resultado pasa del volumen', [], pasa);
Check('T4 barrido: un producto exacto no sube (30x50% = 15, 120x20% = 24)', [], sube);

// T5: tickets -> % (Algoritmo A).
function revisar(nombre, fn, porUnidad, maxVol) {
  var malos = [];
  for (var v = 1; v <= maxVol; v++) {
    var posibles = {};
    for (var k = 0; k <= 100 * porUnidad; k++) posibles[MetaCategoria.tickets(v, String(k / porUnidad))] = true;
    for (var n = 0; n <= v; n++) {
      var r = fn(v, String(n));
      var problema = null;
      if (r.error) problema = 'error ' + r.error;
      else if (Number(r.pct) > 100) problema = 'pasa de 100';
      else if (r.tickets < n) problema = 'da menos';
      else if (r.tickets !== MetaCategoria.tickets(v, r.pct)) problema = 'tickets no cuadra';
      else if (posibles[n] && !(r.exacto && r.tickets === n)) problema = 'habia exacto';
      else if (!posibles[n] && r.exacto) problema = 'exacto falso';
      else {
        var abajo = Math.floor(n * 100 * porUnidad / v) / porUnidad;
        if (MetaCategoria.tickets(v, String(abajo)) === n && Number(r.pct) !== abajo) problema = 'no es la proporcion';
      }
      if (problema && malos.length < 5) malos.push([v, n, r, problema]);
    }
  }
  Check('T5 ' + nombre + ': <= 100%, da al menos n, exacto cuando se puede, y la proporcion hacia abajo cuando la reproduce', [], malos);
}
revisar('MetaCategoria.pct (0.01%, vol 1..80)', MetaCategoria.pct, 100, 80);
revisar('MetaCategoria.pctEntero (1%, vol 1..1500)', MetaCategoria.pctEntero, 1, 1500);
var distintas = [];
for (var v2 = 1; v2 <= 1500; v2++) for (var n2 = 0; n2 <= v2; n2 += (v2 > 200 ? 7 : 1)) {
  var x1 = ini.pctDeTickets(v2, String(n2)), x2 = MetaCategoria.pctEntero(v2, String(n2));
  if (JSON.stringify(x1) !== JSON.stringify(x2) && distintas.length < 5) distintas.push([v2, n2, x1, x2]);
}
Check('T5 pctDeTickets (iniciativas.js) = MetaCategoria.pctEntero', [], distintas);
Check('T5 ejemplos: 15 de 30 = 50%; 7 de 7 = 100%; 1 de 134 = 0.74% (da 1, exacto)',
  [{ pct: '50', exacto: true, tickets: 15 }, { pct: '100', exacto: true, tickets: 7 }, { pct: '0.74', exacto: true, tickets: 1 }],
  [MetaCategoria.pct(30, '15'), MetaCategoria.pct(7, '7'), MetaCategoria.pct(134, '1')]);
Check('T5 a % entero: 15 de 30 = 50; 7 de 7 = 100; 1 de 134 = 1% (da 2: no hay % entero que de 1)',
  [{ pct: '50', exacto: true, tickets: 15 }, { pct: '100', exacto: true, tickets: 7 }, { pct: '1', exacto: false, tickets: 2 }],
  [ini.pctDeTickets(30, '15'), ini.pctDeTickets(7, '7'), ini.pctDeTickets(134, '1')]);
Check('T5 mas tickets que volumen: error, no un % mayor a 100', [true, true],
  [!!MetaCategoria.pct(7, '8').error, !!ini.pctDeTickets(7, '8').error]);

// T6: tablero.
var cv = function (vol, red) { return { vol_slot: { '0': vol }, vol_mes: {}, ticket_reduce: red }; };
var t799 = ini.ticketsDe(7, '99');
Check('T6 tablero: 7 tickets con una iniciativa de 99% -> 7 cubiertos, 0 sin cubrir', [7, 7, 0],
  [t799, tablero.con(cv(7, t799)), tablero.sin(cv(7, t799))]);
Check('T6 tablero: lo cubierto se topa al volumen (9 sobre 7 -> 7 y 0; 0 sobre 7 -> 0 y 7)', [7, 0, 0, 7],
  [tablero.con(cv(7, 9)), tablero.sin(cv(7, 9)), tablero.con(cv(7, 0)), tablero.sin(cv(7, 0))]);

console.log(pasaron + ' pasaron, ' + fallos + ' fallaron');
console.log(fallos ? fallos + ' FALLARON' : 'TODO PASA');
process.exit(fallos ? 1 : 0);
