// tools/tests/ResumenDimSmoke.js - prueba de humo del resumen de "Prioridad de
// lo resuelto" (renderResumenDim de dashboard.js).
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca. Recorta la funcion del propio dashboard.js y la
// corre con un DOM de mentira, para que el total del encabezado y los chips de
// reparto no se rompan sin que nadie se entere. Lo que fija:
//
//   - el total es la SUMA de las rebanadas que pinta la grafica;
//   - el porcentaje es participacion sobre ese total, a un decimal;
//   - una rebanada en 0 da 0.0%, no N/D (si hay denominador);
//   - sin rebanadas -o con total 0- se escribe N/D y el total queda en 0;
//   - la etiqueta se escapa antes de ir a innerHTML.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\ResumenDimSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
// Se normalizan los saltos: el repositorio se revisa en CRLF y el recorte
// busca lineas exactas.
var fuente = fs.readFileSync(path.join(raiz, 'dashboard.js'), 'utf8').split(String.fromCharCode(13)).join('');

// Recorte de la funcion: desde su firma hasta la linea que la cierra con la
// misma sangria. Si alguien la renombra o la mueve, esto falla en vez de
// probar un fantasma.
var ini = fuente.indexOf('  function renderResumenDim(');
if (ini < 0) { console.log('FAIL  renderResumenDim no esta en dashboard.js'); process.exit(1); }
var fin = fuente.indexOf('\n  }\n', ini);
var cuerpo = fuente.slice(ini, fin + 4);

// Dependencias del ambito de dashboard.js, con el mismo comportamiento: FMT
// con separador de miles es-MX y el escape de Escape.html.
var FMT = function (n) {
  return (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('es-MX');
};
var escapeHtml = function (s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
};

var nodos = {};
var document = {
  getElementById: function (id) { return nodos[id] || null; }
};

var renderResumenDim = (new Function('FMT', 'escapeHtml', 'document',
  cuerpo + '\n return renderResumenDim;'))(FMT, escapeHtml, document);

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

function correr(entradas) {
  nodos = {
    'hint-prioridad': { textContent: '' },
    'resumen-prioridad': { innerHTML: '' }
  };
  renderResumenDim('chart-prioridad', entradas);
  return { total: nodos['hint-prioridad'].textContent, chips: nodos['resumen-prioridad'].innerHTML };
}

// A) Reparto normal: el de la captura del tablero.
var a = correr([['Media', 3155], ['Alta', 2528], ['Baja', 1664], ['Critica', 1476]]);
Check('A total = suma de las barras', 'Total: 8,823', a.total);
Check('A Media', true, a.chips.indexOf('<b>Media</b> 3,155 · 35.8%') >= 0);
Check('A Alta', true, a.chips.indexOf('<b>Alta</b> 2,528 · 28.7%') >= 0);
Check('A Baja', true, a.chips.indexOf('<b>Baja</b> 1,664 · 18.9%') >= 0);
Check('A Critica', true, a.chips.indexOf('<b>Critica</b> 1,476 · 16.7%') >= 0);
Check('A los porcentajes suman ~100', '100.1',
  (35.8 + 28.7 + 18.9 + 16.7).toFixed(1));  // el redondeo a un decimal no cierra exacto

// B) Rebanada en cero con denominador valido: 0.0%, NO N/D.
var b = correr([['Media', 10], ['Critica', 0]]);
Check('B total', 'Total: 10', b.total);
Check('B rebanada en cero', true, b.chips.indexOf('<b>Critica</b> 0 · 0.0%') >= 0);

// C) Sin rebanadas (grafica vacia): total 0 y ningun chip.
var c = correr([]);
Check('C total sin rebanadas', 'Total: 0', c.total);
Check('C sin chips', '', c.chips);

// D) Todas las rebanadas en cero: sin denominador se escribe N/D, no 0%.
var d = correr([['Media', 0], ['Alta', 0]]);
Check('D total', 'Total: 0', d.total);
Check('D N/D y no 0%', true, d.chips.indexOf('<b>Media</b> 0 · N/D') >= 0);
Check('D sin porcentaje inventado', -1, d.chips.indexOf('0.0%'));

// E) La etiqueta va escapada: llega de datos, no del codigo.
var e = correr([['<img src=x>', 5]]);
Check('E etiqueta escapada', true, e.chips.indexOf('&lt;img src=x&gt;') >= 0);
Check('E sin etiqueta cruda', -1, e.chips.indexOf('<img'));

// F) Tarjeta sin los huecos del resumen: no revienta (otras graficas de
//    dimension pueden no tenerlos).
nodos = {};
renderResumenDim('chart-otra', [['X', 1]]);
Check('F sin huecos no revienta', 'ok', 'ok');

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASA');
process.exit(fallos ? 1 : 0);
