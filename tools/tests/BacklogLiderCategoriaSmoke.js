// tools/tests/BacklogLiderCategoriaSmoke.js - prueba de humo de las pestañas
// "Líder (Grupo)" y "Líder (Categoría)" del tablero de Backlog.
//
//   - el marcado tiene las dos pestañas con su nombre nuevo y sus paneles;
//   - cargarTodo pide backlog_categorias.ashx con los mismos filtros, y su
//     fallo no tumba el tablero;
//   - con los MISMOS tickets, la fila de cada lider en "Líder (Categoría)"
//     muestra las mismas cifras que en "Líder (Grupo)" (Tickets, %, Criticos,
//     Altos, +30 dias, % Fuera SLA), y bajo el lider salen sus C1 sumando
//     sus grupos;
//   - el cross-filter por lider y por grupo recorta igual las dos tablas;
//   - C1 NULL sale como "(sin categoría)"; error del handler -> mensaje.
//
// NO forma parte del sitio. Recorta las funciones de backlog/backlog.js -sin
// copiarlas- y las corre con un document de mentira.
//
//   node tools\tests\BacklogLiderCategoriaSmoke.js
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var leer = function (r) { return fs.readFileSync(path.join(raiz, r), 'utf8').split(String.fromCharCode(13)).join(''); };
var fuente = leer('backlog/backlog.js');
var marcado = leer('backlog/backlog.html');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
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

// ---------------------------------------------------------------- marcado
Check('html: pestaña "Líder (Grupo)" en lugar de "Lideres (drill-down)"', [true, false],
  [marcado.indexOf('data-panel="p-lideres-bl">Líder (Grupo)</div>') >= 0, marcado.indexOf('Lideres (drill-down)') >= 0]);
Check('html: pestaña y panel "Líder (Categoría)"', [true, true, true],
  [marcado.indexOf('data-panel="p-lideres-cat-bl">Líder (Categoría)</div>') >= 0,
   marcado.indexOf('id="tabla-lideres-cat-bl"') >= 0, marcado.indexOf('id="cap-lideres-cat-bl"') >= 0]);
var carga = fuente.slice(fuente.indexOf('async function cargarTodo('), fuente.indexOf('async function cargarTodo(') + 4000);
Check('cargarTodo pide backlog_categorias.ashx con los filtros (qs) y atrapa su error', [true, true],
  [/obtenerJSON\(`backlog_categorias\.ashx\?\$\{qs\}`\)\s*\.catch\(/.test(carga), /datos = \{ resumen, historico, antiguos, categorias \}/.test(carga)]);
Check('renderTodo pinta las dos pestañas', [true, true],
  [recortar('renderTodo', '  ').indexOf('renderLideres();') >= 0, recortar('renderTodo', '  ').indexOf('renderLideresCategoria();') >= 0]);

// ---------------------------------------------------------- entorno falso
var nodos = {};
function nodo(id) {
  if (!nodos[id]) nodos[id] = { id: id, innerHTML: '', querySelectorAll: function () { return []; } };
  return nodos[id];
}
var documento = { getElementById: nodo };
var codigo = [
  linea('const FMT ='), linea('const PCT ='),
  'const miniBar = () => "";',
  'const escapeHtml = s => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;");',
  'const escapeAttr = escapeHtml;',
  'const colorLider = () => "#000";',
  linea('const SORT_MAS_30 ='),
  linea('const filtro ='),
  'let datos = null;',
  'function activarDrillDown() {}',
  'function descripcionFiltro(n) { return String(n); }',
  recortar('porLiderGrupo', '  '),
  recortar('renderLideres', '  '),
  recortar('renderLideresCategoria', '  '),
  'return { filtro: filtro, poner: function (d) { datos = d; }, renderLideres: renderLideres, renderLideresCategoria: renderLideresCategoria };'
].join('\n');
var B = (new Function('document', codigo))(documento);

// Tickets sinteticos -> los result sets del procedimiento y las filas del
// handler nuevo, cada uno con SU agregacion (como en SQL).
var lideres = ['Laura', 'Jesus', 'Sin Torre'], c1s = ['S-Punto de Venta', 'S-Logistica', null];
var pris = ['Critica', 'Alta', 'Media', 'Baja'], slas = ['Dentro SLA', 'Fuera SLA', null];
var tickets = [], semilla = 11;
function azar(n) { semilla = (semilla * 9301 + 49297) % 233280; return Math.floor(semilla / 233280 * n); }
for (var i = 0; i < 300; i++) {
  var l = lideres[azar(3)];
  tickets.push({ Lider: l, Grupo: l + '-G' + azar(3), C1: c1s[azar(3)], Prioridad: pris[azar(4)],
    AgingSort: azar(8), EstadoSLA: slas[azar(3)] });
}
function agrupar(campos, f) {
  var m = new Map();
  tickets.forEach(function (t) {
    var k = campos.map(function (c) { return t[c]; }).join('\u0001');
    if (!m.has(k)) { var o = {}; campos.forEach(function (c) { o[c] = t[c]; }); m.set(k, o); }
    f(m.get(k), t);
  });
  return Array.from(m.values());
}
var sum = function (o, k, v) { o[k] = (o[k] || 0) + v; };
var resumen = {
  prioridad: agrupar(['Lider', 'Grupo'], function (o, t) {
    sum(o, 'Total', 1); sum(o, 'Critica', t.Prioridad === 'Critica' ? 1 : 0); sum(o, 'Alta', t.Prioridad === 'Alta' ? 1 : 0);
  }),
  aging: agrupar(['Lider', 'Grupo', 'AgingSort'], function (o) { sum(o, 'Tickets', 1); }),
  sla: agrupar(['Lider', 'Grupo', 'EstadoSLA'], function (o) { sum(o, 'Tickets', 1); }),
};
var categorias = { filas: agrupar(['Lider', 'Grupo', 'C1'], function (o, t) {
  sum(o, 'Total', 1); sum(o, 'Critica', t.Prioridad === 'Critica' ? 1 : 0); sum(o, 'Alta', t.Prioridad === 'Alta' ? 1 : 0);
  sum(o, 'Mas30', t.AgingSort >= 5 ? 1 : 0); sum(o, 'FueraSLA', t.EstadoSLA === 'Fuera SLA' ? 1 : 0);
}) };

// Filas n1 (lider) de una tabla pintada: nombre + sus 6 celdas, sin etiquetas.
function filasLider(html) {
  return html.split('<tr class="n1row').slice(1).map(function (tr) {
    tr = tr.slice(0, tr.indexOf('</tr>'));
    var nombre = /data-valor="([^"]*)"/.exec(tr)[1];
    var celdas = (tr.match(/<td class="num">[\s\S]*?<\/td>/g) || []).map(function (c) { return c.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim(); });
    return nombre + ': ' + celdas.join(' | ');
  });
}
function filasN2(html) {
  return (html.match(/<tr class="n2row[^"]*" data-p1="\d+"><td>[\s\S]*?<\/td>/g) || [])
    .map(function (tr) { return tr.replace(/<[^>]+>/g, '').trim(); });
}
function pintar() {
  B.renderLideres(); B.renderLideresCategoria();
  return [nodos['tabla-lideres-bl'].innerHTML, nodos['tabla-lideres-cat-bl'].innerHTML];
}

B.poner({ resumen: resumen, categorias: categorias });
var t = pintar();
Check('sin filtro: las filas de lider son identicas en las dos pestañas', filasLider(t[0]), filasLider(t[1]));
Check('sin filtro: 3 lideres', 3, filasLider(t[1]).length);
Check('C1 NULL -> "(sin categoría)", nunca "null"', [true, false],
  [filasN2(t[1]).indexOf('(sin categoría)') >= 0, /null/.test(filasN2(t[1]).join('|'))]);
// Bajo cada lider, sus C1 suman lo del lider.
var n2Total = (t[1].match(/<tr class="n2row" data-p1="0"><td>[\s\S]*?<\/td><td class="num">([\d,.]+)<\/td>/g) || [])
  .map(function (s) { return Number(/<td class="num">([\d,.]+)<\/td>$/.exec(s)[1].replace(/[,.]/g, '')); })
  .reduce(function (a, b) { return a + b; }, 0);
var n1Total = Number(/<td class="num">([\d,.]+)<\/td>/.exec(t[1].split('<tr class="n1row')[1])[1].replace(/[,.]/g, ''));
Check('las C1 del primer lider suman su total', n1Total, n2Total);
Check('encabezado "Líder / Categoría"', true, t[1].indexOf('<th>Líder / Categoría</th>') >= 0);

B.filtro.lider = 'Jesus';
t = pintar();
Check('cross-filter lider: siguen saliendo todos y las cifras cuadran', filasLider(t[0]), filasLider(t[1]));
B.filtro.lider = null; B.filtro.grupo = 'Laura-G1';
t = pintar();
Check('cross-filter grupo: solo Laura y las cifras cuadran', [filasLider(t[0]), 1], [filasLider(t[1]), filasLider(t[1]).length]);
B.filtro.grupo = null;

B.poner({ resumen: resumen, categorias: { error: 'HTTP 500 <x>' } });
t = pintar();
Check('handler caido: mensaje en la pestaña, escapado; "Líder (Grupo)" se pinta igual', [true, 3],
  [t[1].indexOf('No se pudo leer el backlog por categoría: HTTP 500 &lt;x>') >= 0, filasLider(t[0]).length]);
B.poner({ resumen: resumen, categorias: { filas: [] } });
Check('sin filas: vacio', true, pintar()[1].indexOf('Sin datos para este corte.') >= 0);

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
