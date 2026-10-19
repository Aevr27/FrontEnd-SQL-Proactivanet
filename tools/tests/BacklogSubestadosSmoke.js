// tools/tests/BacklogSubestadosSmoke.js - prueba de humo de la grafica "Por
// subestado" del tablero de Backlog y del result set 7 que la alimenta:
//
//   - backlog_resumen.ashx entrega el result set 7 como "subestados" y deja
//     los seis primeros en sus posiciones de siempre;
//   - las barras son horizontales, de mayor a menor, con las categorias y
//     cifras que devuelve el procedimiento (sin lista fija) y los rotulos tal
//     cual, acentos y punto final incluidos;
//   - Subestado NULL / vacio no se grafica ni se renombra: el pie dice cuantos;
//   - con cross-filter el pie avisa que esta grafica no se recorta;
//   - sin filas, o con un procedimiento anterior sin el set 7, sale el
//     mensaje de vacio y no una grafica;
//   - renderTodo sigue pintando todas las graficas de antes.
//
// NO forma parte del sitio. Recorta las funciones de backlog/backlog.js -sin
// copiarlas- y las corre con un document y un DashboardBarChart de mentira.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\BacklogSubestadosSmoke.js   # PASS/FAIL, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var leer = function (r) { return fs.readFileSync(path.join(raiz, r), 'utf8').split(String.fromCharCode(13)).join(''); };
var fuente = leer('backlog/backlog.js');
var handler = leer('handlers/backlog_resumen.ashx');
var marcado = leer('backlog/backlog.html');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

function recortar(nombre, sangria) {
  var firma = '\n' + sangria + 'function ' + nombre + '(';
  var ini = fuente.indexOf(firma);
  if (ini < 0) { console.log('FAIL  ' + nombre + ' no esta en backlog.js'); process.exit(1); }
  var fin = fuente.indexOf('\n' + sangria + '}\n', ini);
  return fuente.slice(ini, fin + sangria.length + 3);
}
function linea(prefijo) {
  var ini = fuente.indexOf(prefijo);
  if (ini < 0) { console.log('FAIL  ' + prefijo + ' no esta en backlog.js'); process.exit(1); }
  return fuente.slice(ini, fuente.indexOf('\n', ini));
}

// ---------------------------------------------------------------- handler
Check('handler: subestados = result set 7 (indice 6)', true, /\{ "subestados",\s+Filas\(sets, 6\) \}/.test(handler));
['kpis|PrimeraFila(sets, 0)', 'prioridad|Filas(sets, 1)', 'aging|Filas(sets, 2)',
 'reasignaciones|Filas(sets, 3)', 'reabiertos|Filas(sets, 4)', 'sla|Filas(sets, 5)'].forEach(function (par) {
  var p = par.split('|');
  Check('handler: ' + p[0] + ' sigue en su posicion', true,
    new RegExp('\\{ "' + p[0] + '",\\s+' + p[1].replace(/[()]/g, '\\$&') + ' \\}').test(handler));
});
Check('html: lienzo y pie de la grafica', true,
  marcado.indexOf('id="chart-subestado-bl"') >= 0 && marcado.indexOf('id="cap-subestado-bl"') >= 0);

// ---------------------------------------------------------- entorno falso
var ventana = {};
(new Function('window', leer('assets/js/paleta.js')))(ventana);

var nodos = {};
function nodo(id) {
  if (!nodos[id]) nodos[id] = { id: id, textContent: '', parentElement: { style: { height: '' } } };
  return nodos[id];
}
var documento = { getElementById: nodo };

var hechas = [], vacias = [];
function GraficaFalsa(cfg) { this.cfg = cfg; hechas.push(cfg); }
GraficaFalsa.prototype.render = function () { return this; };
function vaciaFalsa(id, msg) { vacias.push(id + '|' + msg); return true; }

var codigo = [
  linea('const FMT = '),
  recortar('dimensionesActivas', ''),
  linea('const EJE_Y_CERO = '),
  'let datos = null; const graficos = {};',
  'const filtro = { lider: null, grupo: null, prioridad: null, aging: null };',
  recortar('hayFiltro', '  '), recortar('renderBarrasSubestado', '  '),
  'return { pintar: renderBarrasSubestado, filtro: filtro, poner: function (d) { datos = d; } };',
].join('\n');
var m = (new Function('document', 'Paleta', 'DashboardBarChart', 'renderEmptyChart', codigo))(
  documento, ventana.Paleta, GraficaFalsa, vaciaFalsa);

function pintar(subestados) {
  hechas = []; vacias = [];
  m.poner({ resumen: { subestados: subestados } });
  m.pintar();
  return hechas[0] || null;
}
var N = function (n) { return n.toLocaleString('es-MX'); };

// Corte 2026-10-19 en la VM (diag_backlog_subestados.sql sec 5b), en desorden
// a proposito para comprobar que la grafica ordena sola.
var corte = [
  { Subestado: 'Reasignado', Tickets: 584 },
  { Subestado: 'En espera de documentación', Tickets: 2 },
  { Subestado: 'En Proceso', Tickets: 2627 },
  { Subestado: 'Escalado/Dependencia', Tickets: 63 },
  { Subestado: 'Acción del Usuario.', Tickets: 139 },
  { Subestado: 'En trámite de compra', Tickets: 1042 },
  { Subestado: 'En espera del CAB/Autorización', Tickets: 65 },
];

// ---- Corte real
var g = pintar(corte);
Check('se pinta una grafica', true, g !== null);
Check('horizontal', 'y', g.opciones.indexAxis);
Check('siete categorias, todas las del set', 7, g.etiquetas.length);
Check('orden de mayor a menor', [2627, 1042, 584, 139, 65, 63, 2].join(','), g.datos.join(','));
Check('rotulos tal cual (acentos, punto final)',
  'En Proceso|En trámite de compra|Reasignado|Acción del Usuario.|En espera del CAB/Autorización|Escalado/Dependencia|En espera de documentación',
  g.etiquetas.join('|'));
Check('total = backlog del corte (4522)', 4522, g.datos.reduce(function (a, b) { return a + b; }, 0));
Check('cifra en la barra con el formato del tablero', N(2627), g.formato(2627));
Check('un solo color para la serie', 1, new Set(g.colores).size);
Check('sin clic (no hay dimension para filtrar)', true, g.opciones.onClick === undefined);
Check('rotulos sin saltarse', false, g.opciones.scales.y.ticks.autoSkip);
Check('eje de cifras desde cero', true, g.opciones.scales.x.beginAtZero);
Check('sin aviso en el pie', '', nodos['cap-subestado-bl'].textContent);
Check('alto con siete filas: 7 x 34 + 30', (7 * 34 + 30) + 'px', nodos['chart-subestado-bl'].parentElement.style.height);

// ---- Empate: desempata por nombre
g = pintar([{ Subestado: 'B', Tickets: 5 }, { Subestado: 'A', Tickets: 5 }, { Subestado: 'C', Tickets: 9 }]);
Check('empate por nombre', 'C|A|B', g.etiquetas.join('|'));

// ---- NULL / vacio: fuera de las barras, contados en el pie, sin rotulo inventado
g = pintar(corte.concat([{ Subestado: null, Tickets: 42 }, { Subestado: '  ', Tickets: 3 }]));
Check('NULL no entra a las barras', 7, g.etiquetas.length);
Check('ningun rotulo inventado', false, g.etiquetas.some(function (e) { return e === null || /sin subestado/i.test(e); }));
Check('pie cuenta los sin subestado', true, nodos['cap-subestado-bl'].textContent.indexOf('45 tickets de este corte no tienen subestado') === 0);

// ---- Cross-filter: aviso, mismas cifras
m.filtro.lider = 'Ana';
g = pintar(corte);
Check('cross-filter: avisa que no se recorta', true, /No se recorta con la seleccion/.test(nodos['cap-subestado-bl'].textContent));
Check('cross-filter: cifras del set sin tocar', 2627, g.datos[0]);
m.filtro.lider = null;
g = pintar(corte);
Check('sin cross-filter: el aviso se va', '', nodos['cap-subestado-bl'].textContent);

// ---- Pocas categorias: piso del .lienzo
g = pintar([{ Subestado: 'A', Tickets: 3 }, { Subestado: 'B', Tickets: 1 }]);
Check('dos filas: piso de 260', '260px', nodos['chart-subestado-bl'].parentElement.style.height);

// ---- Muchas categorias: el lienzo crece
var muchas = [];
for (var i = 0; i < 12; i++) muchas.push({ Subestado: 'S' + i, Tickets: i + 1 });
g = pintar(muchas);
Check('doce filas: alto crece', (12 * 34 + 30) + 'px', nodos['chart-subestado-bl'].parentElement.style.height);

// ---- Vacios
g = pintar([]);
Check('sin filas: no hay grafica', null, g);
Check('sin filas: mensaje de vacio', 'chart-subestado-bl|Sin tickets en backlog para este corte y filtros.', vacias[0]);
Check('sin filas: alto vuelve al del .lienzo', '', nodos['chart-subestado-bl'].parentElement.style.height);
g = pintar(undefined);
Check('procedimiento sin set 7: mensaje de vacio, sin error', 1, vacias.length);
g = pintar([{ Subestado: null, Tickets: 10 }]);
Check('solo NULL: vacio + pie con la cuenta', true, vacias.length === 1 && nodos['cap-subestado-bl'].textContent.indexOf('10 tickets') === 0);

// ---- Regresion: renderTodo sigue con todo lo de antes, y la nueva
var todo = recortar('renderTodo', '  ');
['renderKpis', 'renderTendenciaTotal', 'renderTendenciaLider', 'renderBarrasLider', 'renderBarrasPrioridad',
 'renderBarrasAging', 'renderBarrasSubestado', 'renderLideres', 'renderTablaAging', 'renderAntiguos'].forEach(function (f) {
  Check('renderTodo llama ' + f, true, todo.indexOf(f + '();') >= 0);
});

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
