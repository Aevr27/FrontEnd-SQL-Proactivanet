// tools/tests/SlotsSlaSmoke.js - prueba de humo de los SLOTs de la pestaña SLA.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca. Recorta de dashboard.js las funciones que
// reparten los dias en SLOTs -sin copiarlas- y las corre con un "hoy" fijo:
//
//   - SLOT 0 = ayer-30 .. ayer (31 dias), ya no "ayer -> ayer";
//   - cada SLOT empieza el dia siguiente al fin del SLOT mas viejo, sin hueco
//     ni solape, del 0 al MAX_SLOTS;
//   - slotDeFecha es la inversa exacta de slotRango;
//   - agruparPorSlot cuenta cada dia en UN solo SLOT y el rango del tooltip
//     es el mismo que acota la suma.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\SlotsSlaSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var fuente = fs.readFileSync(path.join(raiz, 'dashboard.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

// Recorte de una funcion: desde su firma hasta la llave de cierre con la misma
// sangria. Si se renombra o se mueve, falla en vez de probar un fantasma.
function recortar(nombre, sangria) {
  var firma = '\n' + sangria + 'function ' + nombre + '(';
  var ini = fuente.indexOf(firma);
  if (ini < 0) { console.log('FAIL  ' + nombre + ' no esta en dashboard.js'); process.exit(1); }
  var fin = fuente.indexOf('\n' + sangria + '}\n', ini);
  return fuente.slice(ini, fin + sangria.length + 3);
}
function constante(nombre) {
  var m = new RegExp('const ' + nombre + ' = (\\d+);').exec(fuente);
  if (!m) { console.log('FAIL  ' + nombre + ' no esta en dashboard.js'); process.exit(1); }
  return Number(m[1]);
}
var DIAS_SLOT = constante('DIAS_SLOT');
var MAX_SLOTS = constante('MAX_SLOTS');

// Date con "hoy" fijo: new Date() sin argumentos devuelve el instante dado;
// con argumentos se comporta como el Date de siempre.
function relojFijo(iso) {
  var t = new Date(iso).getTime();
  function D() {
    if (arguments.length === 0) return new Date(t);
    return new (Function.prototype.bind.apply(Date, [null].concat([].slice.call(arguments))))();
  }
  D.prototype = Date.prototype;
  D.now = function () { return t; };
  return D;
}

var codigo =
  'var DIAS_SLOT = ' + DIAS_SLOT + ';\n' +
  recortar('formatoFecha', '') +
  recortar('slotRango', '  ') + recortar('rangoSlots', '  ') +
  recortar('diasAtras', '  ') + recortar('slotDeFecha', '  ') +
  recortar('agruparPorSlot', '  ') + recortar('resumenSlots', '  ') +
  '\nreturn { slotRango: slotRango, rangoSlots: rangoSlots, slotDeFecha: slotDeFecha,' +
  ' agruparPorSlot: agruparPorSlot, resumenSlots: resumenSlots, formatoFecha: formatoFecha };';

function tablero(ahora) { return (new Function('Date', codigo))(relojFijo(ahora)); }

// Dia siguiente / anterior de un aaaa-mm-dd, en UTC para no depender de la
// zona de la maquina que corre la prueba.
function mover(iso, n) {
  var t = iso.split('-');
  var d = new Date(Date.UTC(+t[0], +t[1] - 1, +t[2] + n));
  return d.toISOString().slice(0, 10);
}
function diasEntre(a, b) {   // b - a, en dias
  var ta = a.split('-'), tb = b.split('-');
  return (Date.UTC(+tb[0], +tb[1] - 1, +tb[2]) - Date.UTC(+ta[0], +ta[1] - 1, +ta[2])) / 86400000;
}

// Varias horas y fechas: de madrugada, de noche (cuando UTC ya es "mañana"),
// cruce de año y fin de horario de verano en EE. UU.
var momentos = ['2026-10-05T09:30:00', '2026-10-05T23:45:00', '2026-01-02T00:10:00',
                '2026-11-02T12:00:00', '2026-03-31T18:00:00'];

momentos.forEach(function (ahora) {
  var T = tablero(ahora);
  var hoy = ahora.slice(0, 10);
  var ayer = mover(hoy, -1);
  var p = '[' + ahora + '] ';

  // --- Limites del SLOT 0
  var s0 = T.slotRango(0);
  Check(p + 'SLOT 0 fin = ayer', ayer, s0.fin);
  Check(p + 'SLOT 0 inicio = ayer - 30', mover(ayer, -30), s0.inicio);
  Check(p + 'SLOT 0 no es un solo dia', true, s0.inicio !== s0.fin);
  Check(p + 'SLOT 0 mide 31 dias (extremos dentro)', 31, diasEntre(s0.inicio, s0.fin) + 1);

  // --- Continuidad y tamaño de todos los SLOTs
  var huecos = 0, tamanosMal = 0;
  for (var k = 1; k <= MAX_SLOTS; k++) {
    var r = T.slotRango(k), reciente = T.slotRango(k - 1);
    if (mover(r.fin, 1) !== reciente.inicio) huecos++;
    if (diasEntre(r.inicio, r.fin) + 1 !== DIAS_SLOT) tamanosMal++;
  }
  Check(p + 'SLOT k+1 acaba el dia antes de que empiece el SLOT k (0..' + MAX_SLOTS + ')', 0, huecos);
  Check(p + 'SLOTs 1..' + MAX_SLOTS + ' miden ' + DIAS_SLOT + ' dias', 0, tamanosMal);
  Check(p + 'SLOT 1 empieza donde acaba el 0', mover(s0.inicio, -1), T.slotRango(1).fin);

  // --- slotDeFecha es la inversa de slotRango
  var malAsignados = 0, fueraDeSuRango = 0;
  for (var d = 1; d <= (MAX_SLOTS + 1) * DIAS_SLOT + 1; d++) {
    var f = mover(hoy, -d);
    var s = T.slotDeFecha(f);
    var rs = T.slotRango(s);
    if (s < 0) { malAsignados++; continue; }
    if (f < rs.inicio || f > rs.fin) fueraDeSuRango++;
  }
  Check(p + 'cada dia de ayer hacia atras cae en un SLOT', 0, malAsignados);
  Check(p + 'cada dia cae dentro del rango de su SLOT', 0, fueraDeSuRango);
  Check(p + 'hoy no cae en ningun SLOT', -1, T.slotDeFecha(hoy));
  Check(p + 'ayer es SLOT 0', 0, T.slotDeFecha(ayer));
  Check(p + 'ayer-30 es SLOT 0', 0, T.slotDeFecha(mover(ayer, -30)));
  Check(p + 'ayer-31 es SLOT 1', 1, T.slotDeFecha(mover(ayer, -31)));
  Check(p + 'ayer-60 es SLOT 1', 1, T.slotDeFecha(mover(ayer, -60)));
  Check(p + 'ayer-61 es SLOT 2', 2, T.slotDeFecha(mover(ayer, -61)));

  // --- Agrupado: cada dia en un solo SLOT, la suma cuadra con el rango
  [1, 3, MAX_SLOTS].forEach(function (n) {
    var rango = T.rangoSlots(n);
    Check(p + 'N=' + n + ' rango acaba ayer', ayer, rango.fin);
    Check(p + 'N=' + n + ' rango empieza en el inicio del SLOT N', T.slotRango(n).inicio, rango.inicio);
    // Serie diaria como la que trae tendencia.ashx: un ticket por dia, del
    // inicio del rango hasta HOY (hoy tambien puede venir en los datos) y un
    // dia de mas por delante del inicio, que no debe contarse.
    var fechas = [], unos = [], ids = [];
    for (var f2 = mover(rango.inicio, -1); f2 <= hoy; f2 = mover(f2, 1)) {
      fechas.push(f2); unos.push(1); ids.push(fechas.length);
    }
    var g = T.agruparPorSlot(fechas, [unos], n);
    var etiquetas = [];
    for (var s2 = n; s2 >= 0; s2--) etiquetas.push('SLOT ' + s2);
    Check(p + 'N=' + n + ' etiquetas viejo -> reciente', etiquetas.join(','), g.etiquetas.join(','));
    var esperado = g.rangos.map(function (r) { return diasEntre(r.inicio, r.fin) + 1; });
    Check(p + 'N=' + n + ' cada SLOT suma los dias de su rango', esperado.join(','), g.series[0].join(','));
    var total = g.series[0].reduce(function (a, b) { return a + b; }, 0);
    Check(p + 'N=' + n + ' total = dias del rango (sin hoy ni el dia previo)',
      diasEntre(rango.inicio, rango.fin) + 1, total);
    Check(p + 'N=' + n + ' rangos del tooltip = slotRango',
      JSON.stringify(etiquetas.map(function (_, i) { return T.slotRango(n - i); })), JSON.stringify(g.rangos));
    // Titulo del tooltip, con la misma plantilla que dashboard.js.
    var r0 = g.rangos[g.rangos.length - 1];
    var titulo = g.etiquetas[g.etiquetas.length - 1] + ' · ' + r0.inicio + ' → ' + r0.fin;
    Check(p + 'N=' + n + ' tooltip SLOT 0', 'SLOT 0 · ' + mover(ayer, -30) + ' → ' + ayer, titulo);
  });

  Check(p + 'resumen N=1', 'SLOT 0-1 · 61 días hasta ayer', T.resumenSlots(1));
});

// La plantilla del tooltip sigue siendo la que se prueba arriba.
Check('plantilla del tooltip en dashboard.js', 3,
  fuente.split('if (r) return `${items[0].label} · ${r.inicio} → ${r.fin}`;').length - 1);

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo PASS');
process.exit(fallos ? 1 : 0);
