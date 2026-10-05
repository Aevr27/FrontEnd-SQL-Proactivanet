// tools/tests/BacklogAgingAntiguosSmoke.js - prueba de humo de dos tablas del
// tablero de Backlog:
//
//   - "Resumen por antiguedad" con drill-down: cada cubo se despliega en los
//     grupos que tienen tickets en el, la suma de sus grupos es el total del
//     cubo, ningun grupo sale en un cubo que no es el suyo, y los filtros
//     (lider, grupo, antiguedad) siguen recortando la tabla;
//   - "Tickets mas antiguos": una lista global del mas viejo al mas nuevo por
//     FechaRegistro, empates por codigo, sin fecha al final, tope de 100 y
//     cross-filter por lider / grupo / prioridad.
//
// NO forma parte del sitio. Recorta las funciones de backlog/backlog.js -sin
// copiarlas- y las corre con un DOM de mentira que solo guarda innerHTML.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\BacklogAgingAntiguosSmoke.js   # PASS/FAIL, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var fuente = fs.readFileSync(path.join(raiz, 'backlog', 'backlog.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

function recortar(nombre) {
  var firma = '\n  function ' + nombre + '(';
  var ini = fuente.indexOf(firma);
  if (ini < 0) { console.log('FAIL  ' + nombre + ' no esta en backlog.js'); process.exit(1); }
  var fin = fuente.indexOf('\n  }\n', ini);
  return fuente.slice(ini, fin + 5);
}
function constante(nombre) {
  var m = new RegExp('const ' + nombre + ' = (\\d+);').exec(fuente);
  if (!m) { console.log('FAIL  ' + nombre + ' no esta en backlog.js'); process.exit(1); }
  return Number(m[1]);
}

// paleta.js y escape.js se escriben en `window`.
var ventana = {};
['paleta.js', 'escape.js'].forEach(function (a) {
  (new Function('window', fs.readFileSync(path.join(raiz, 'assets', 'js', a), 'utf8')))(ventana);
});

// DOM de mentira: getElementById devuelve un nodo que guarda innerHTML.
var nodos = {};
var documento = {
  getElementById: function (id) {
    if (!nodos[id]) nodos[id] = { innerHTML: '', querySelectorAll: function () { return []; } };
    return nodos[id];
  }
};

var codigo =
  'var TOPE_ANTIGUOS = ' + constante('TOPE_ANTIGUOS') + ';\n' +
  'var LARGO_TOOLTIP = 300, URL_TICKET_PROACTIVANET = "https://x/?id=";\n' +
  'var FMT = function (n) { return n === null || n === undefined ? "" : String(n); };\n' +
  'var miniBar = function () { return ""; };\n' +
  'var escapeHtml = function (s) { return Escape.html(s); }, escapeAttr = function (s) { return Escape.attr(s); };\n' +
  'var colorLider = function (n) { return Paleta.colorLider(n); };\n' +
  'var filtro = { lider: null, grupo: null, prioridad: null, aging: null };\n' +
  'var datos = null;\n' +
  'function hayFiltro() { return filtro.lider !== null || filtro.grupo !== null || filtro.prioridad !== null || filtro.aging !== null; }\n' +
  'function descripcionFiltro(n) { return "n=" + n; }\n' +
  'function hacerOrdenable() {}\n' +
  'function alternarFiltro() {}\n' +
  recortar('porLiderGrupo') + recortar('agingFiltrado') +
  recortar('activarDrillDown') + recortar('construirMatrizAging') +
  recortar('gruposPorAging') + recortar('renderTablaAging') +
  recortar('limpiarDescripcion') + recortar('celdaCodigo') + recortar('tooltipDescripcion') +
  recortar('masViejoPrimero') + recortar('antiguosVisibles') + recortar('renderAntiguos') +
  '\nreturn { filtro: filtro, poner: function (d) { datos = d; },' +
  ' gruposPorAging: gruposPorAging, renderTablaAging: renderTablaAging,' +
  ' antiguosVisibles: antiguosVisibles, renderAntiguos: renderAntiguos, masViejoPrimero: masViejoPrimero };';
var T = (new Function('document', 'Paleta', 'Escape', codigo))(documento, ventana.Paleta, ventana.Escape);
function limpiarFiltro() { T.filtro.lider = T.filtro.grupo = T.filtro.prioridad = T.filtro.aging = null; }

// ------------------------------------------------------- Resumen por antiguedad
// Filas como las del result set de antiguedad del SP: (Aging, AgingSort,
// Lider, Grupo, Tickets). Un grupo aparece en varios cubos; 10 lideres para
// que dos caigan en 'Otros'.
var cubos = [['Menos de 1 día', 1], ['1-7 dias', 2], ['8-15 dias', 3], ['+16 dias', 4], ['+1 mes', 5], ['+2 meses', 6]];
var aging = [];
var lideresAging = ['Ana', 'Beto', 'Caro', 'Dani', 'Eva', 'Fer', 'Gabo', 'Hugo', 'Ines', 'Sin Torre'];
lideresAging.forEach(function (l, il) {
  for (var g = 0; g < 3; g++) {
    cubos.forEach(function (c, ic) {
      var n = (il * 7 + g * 3 + ic * 5) % 11;      // a veces 0: ese grupo no esta en ese cubo
      if (n === 0) return;
      aging.push({ Aging: c[0], AgingSort: c[1], Lider: l, Grupo: l + ' / G' + g, Tickets: n * (10 - il) });
    });
  }
});
T.poner({ resumen: { aging: aging }, antiguos: {} });

function analizarAging() {
  var html = nodos['tabla-aging-bl'].innerHTML;
  var filas = html.split('<tr').slice(2);   // sin thead
  var res = { n1: [], n2: {}, total: null };
  filas.forEach(function (f) {
    var celdas = (f.match(/<td[^>]*>[\s\S]*?<\/td>/g) || []).map(function (c) { return c.replace(/<[^>]*>/g, '').trim(); });
    var n1 = /class="n1row[^"]*" data-n1="(\d+)"/.exec(f);
    var n2 = /class="n2row[^"]*" data-p1="(\d+)"/.exec(f);
    if (n1) res.n1.push({ i: n1[1], cubo: celdas[0], total: Number(celdas[celdas.length - 1]) });
    else if (n2) (res.n2[n2[1]] = res.n2[n2[1]] || []).push({ grupo: celdas[0], total: Number(celdas[celdas.length - 1]),
      columnas: celdas.slice(1, -1).filter(function (x) { return x !== ''; }).length });
    else res.total = Number(celdas[celdas.length - 1]);
  });
  return res;
}

limpiarFiltro();
T.renderTablaAging();
var a = analizarAging();
var cubosConDatos = cubos.filter(function (c) { return aging.some(function (x) { return x.Aging === c[0]; }); });
Check('una fila desplegable por cubo', cubosConDatos.length, a.n1.length);
Check('cubos en orden de antiguedad', cubosConDatos.map(function (c) { return c[0]; }).join('|'),
  a.n1.map(function (x) { return x.cubo; }).join('|'));
var granTotal = aging.reduce(function (s, x) { return s + x.Tickets; }, 0);
Check('total general = suma del result set', granTotal, a.total);
Check('suma de cubos = total general', granTotal, a.n1.reduce(function (s, x) { return s + x.total; }, 0));
a.n1.forEach(function (c) {
  var hijos = a.n2[c.i] || [];
  var esperados = aging.filter(function (x) { return x.Aging === c.cubo; });
  Check('[' + c.cubo + '] se puede abrir: tiene grupos', true, hijos.length > 0);
  Check('[' + c.cubo + '] grupos = los del result set en ese cubo',
    esperados.map(function (x) { return x.Grupo; }).sort().join('|'), hijos.map(function (h) { return h.grupo; }).sort().join('|'));
  Check('[' + c.cubo + '] suma de grupos = total del cubo', c.total, hijos.reduce(function (s, h) { return s + h.total; }, 0));
  Check('[' + c.cubo + '] cada grupo en una sola columna de lider', 0,
    hijos.filter(function (h) { return h.columnas !== 1; }).length);
  Check('[' + c.cubo + '] grupos de mas a menos tickets', true,
    hijos.every(function (h, k) { return k === 0 || hijos[k - 1].total >= h.total; }));
});
// Ningun ticket en dos cubos: cada (cubo, grupo) del result set sale una vez.
var pares = [];
a.n1.forEach(function (c) { (a.n2[c.i] || []).forEach(function (h) { pares.push(c.cubo + '|' + h.grupo); }); });
Check('ningun grupo repetido dentro de un cubo', pares.length, new Set(pares).size);
Check('drill-down usa el patron .n1row/.n2row de Lideres', true,
  /class="n1row/.test(nodos['tabla-aging-bl'].innerHTML) && /class="n2row/.test(nodos['tabla-aging-bl'].innerHTML));

// Filtros: lider, grupo, antiguedad.
T.filtro.lider = 'Caro'; T.renderTablaAging(); a = analizarAging();
Check('filtro lider: total = tickets de Caro', aging.filter(function (x) { return x.Lider === 'Caro'; })
  .reduce(function (s, x) { return s + x.Tickets; }, 0), a.total);
Check('filtro lider: solo grupos de Caro', true, Object.keys(a.n2).every(function (k) {
  return a.n2[k].every(function (h) { return h.grupo.indexOf('Caro / ') === 0; }); }));
limpiarFiltro(); T.filtro.grupo = 'Beto / G1'; T.renderTablaAging(); a = analizarAging();
Check('filtro grupo: un grupo por cubo', true, Object.keys(a.n2).every(function (k) { return a.n2[k].length === 1; }));
limpiarFiltro(); T.filtro.aging = '+1 mes'; T.renderTablaAging(); a = analizarAging();
Check('filtro antiguedad: un solo cubo', '+1 mes', a.n1.map(function (x) { return x.cubo; }).join('|'));
limpiarFiltro(); T.poner({ resumen: { aging: [] }, antiguos: {} }); T.renderTablaAging();
Check('sin datos: mensaje vacio', true, /class="vacio"/.test(nodos['tabla-aging-bl'].innerHTML));

// ------------------------------------------------------- Tickets mas antiguos
Check('TOPE_ANTIGUOS', 100, constante('TOPE_ANTIGUOS'));
var tickets = [];
var lideresT = ['Ana', 'Beto', 'Caro', 'Sin Torre'];
var prios = ['Critica', 'Alta', 'Media', 'Baja'];
for (var i = 0; i < 400; i++) {
  var dia = 1 + ((i * 37) % 300);
  var f = i % 53 === 0 ? null : '2025-' + String(1 + Math.floor(dia / 28) % 12).padStart(2, '0') + '-' +
    String(1 + dia % 28).padStart(2, '0') + 'T' + (i % 3 === 0 ? '08' : '08') + ':00:00';
  tickets.push({ CodigoTicket: 'INC' + String(1000 - i).padStart(5, '0'), FechaRegistro: f,
    Lider: lideresT[i % 4], Grupo: lideresT[i % 4] + ' / G' + (i % 2), Prioridad: prios[(i >> 2) % 4],
    DiasBacklog: 0, Titulo: 't', Descripcion: '' });
}
function claveOrden(t) { return (t.FechaRegistro || '￿') + '|' + t.CodigoTicket; }
var esperado = tickets.slice().sort(function (x, y) { return claveOrden(x) < claveOrden(y) ? -1 : 1; });

limpiarFiltro();
var vis = T.antiguosVisibles(tickets, 100);
Check('lista acotada a 100', 100, vis.length);
Check('primer ticket = el mas antiguo', esperado[0].CodigoTicket, vis[0].CodigoTicket);
Check('los 100 = los 100 mas antiguos, en orden', esperado.slice(0, 100).map(function (t) { return t.CodigoTicket; }).join(','),
  vis.map(function (t) { return t.CodigoTicket; }).join(','));
Check('orden ascendente por fecha', true, vis.every(function (t, k) {
  return k === 0 || !t.FechaRegistro || (vis[k - 1].FechaRegistro && vis[k - 1].FechaRegistro <= t.FechaRegistro); }));
var masRecientes = esperado.filter(function (t) { return t.FechaRegistro; }).slice(-100).map(function (t) { return t.CodigoTicket; });
Check('no son los 100 mas recientes', 0, vis.filter(function (t) { return masRecientes.indexOf(t.CodigoTicket) >= 0; }).length);
Check('empate de fecha: decide el codigo (estable)', -1,
  T.masViejoPrimero({ FechaRegistro: '2025-01-01T08:00:00', CodigoTicket: 'INC1' }, { FechaRegistro: '2025-01-01T08:00:00', CodigoTicket: 'INC2' }));
Check('sin fecha va al final', 1, T.masViejoPrimero({ FechaRegistro: null, CodigoTicket: 'A' }, { FechaRegistro: '2030-01-01', CodigoTicket: 'B' }));
Check('mismo resultado con la entrada al reves', vis.map(function (t) { return t.CodigoTicket; }).join(','),
  T.antiguosVisibles(tickets.slice().reverse(), 100).map(function (t) { return t.CodigoTicket; }).join(','));
Check('menos de 100 en el corte: salen todos', 7, T.antiguosVisibles(tickets.slice(0, 7), 100).length);

['lider', 'grupo', 'prioridad'].forEach(function (dim) {
  limpiarFiltro();
  var campo = { lider: 'Lider', grupo: 'Grupo', prioridad: 'Prioridad' }[dim];
  var valor = tickets[5][campo];
  T.filtro[dim] = valor;
  var v = T.antiguosVisibles(tickets, 100);
  Check('filtro ' + dim + '=' + valor + ': sus mas antiguos, en orden',
    esperado.filter(function (t) { return t[campo] === valor; }).slice(0, 100).map(function (t) { return t.CodigoTicket; }).join(','),
    v.map(function (t) { return t.CodigoTicket; }).join(','));
});

limpiarFiltro();
T.poner({ resumen: { aging: [] }, antiguos: { tickets: tickets, total: 4321 } });
T.renderAntiguos();
var htmlA = nodos['tabla-antiguos-bl'].innerHTML;
Check('una sola tabla', 1, (htmlA.match(/<table>/g) || []).length);
Check('100 filas', 100, (htmlA.match(/<tr>/g) || []).length - 1);
Check('columna Lider visible', true, /<th>Lider<\/th>/.test(htmlA));
Check('primera fila = el mas antiguo', true, htmlA.indexOf(esperado[0].CodigoTicket) < htmlA.indexOf(esperado[1].CodigoTicket));
Check('pie con el total del corte', true, /4321/.test(nodos['cap-antiguos-bl'].innerHTML));

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo PASS');
process.exit(fallos ? 1 : 0);
