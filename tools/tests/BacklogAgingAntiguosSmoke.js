// tools/tests/BacklogAgingAntiguosSmoke.js - prueba de humo de dos tablas del
// tablero de Backlog:
//
//   - "Resumen por antiguedad" con drill-down: cada cubo se despliega en los
//     grupos que tienen tickets en el, la suma de sus grupos es el total del
//     cubo, ningun grupo sale en un cubo que no es el suyo, y los filtros
//     (lider, grupo, antiguedad) siguen recortando la tabla;
//     La flecha y las cifras del cubo (cada lider y el Total) despliegan, solo
//     el nombre filtra, el fondo de la fila no hace nada, y nada de eso pide
//     algo a la red;
//   - "Tickets mas antiguos": una tarjeta por lider con sus mas viejos por
//     FechaRegistro (empates por codigo, sin fecha al final), 10 al abrir y
//     "Ver 25 mas" por lider -10, 35, 60, 85, 100- sin pasar de 100, sin red,
//     con el cross-filter por lider / grupo / prioridad.
//
// NO forma parte del sitio. Recorta las funciones de backlog/backlog.js -sin
// copiarlas- y las corre con un DOM de mentira: un arbol minimo que se arma
// del innerHTML, con clases, data-*, listeners y burbujeo de clics.
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

// ------------------------------------------------------------ DOM de mentira
// Arbol minimo armado del innerHTML: etiquetas, clases, atributos (data-* en
// dataset), listeners y clics que burbujean hasta que alguien llama a
// stopPropagation. Selectores: '.clase', 'etiqueta' y '.clase[attr="v"]'.
var VACIAS = { br: 1, input: 1, img: 1, hr: 1 };
function desescapar(v) {
  return v.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}
function Nodo(tag, attrs, padre) {
  var n = this;
  n.tagName = tag; n.attrs = attrs || {}; n.parent = padre || null; n.hijos = []; n.oyentes = [];
  n.dataset = {};
  Object.keys(n.attrs).forEach(function (k) {
    if (k.indexOf('data-') === 0) n.dataset[k.slice(5).replace(/-(\w)/g, function (_, c) { return c.toUpperCase(); })] = n.attrs[k];
  });
  var clases = (n.attrs['class'] || '').split(/\s+/).filter(Boolean);
  n.classList = {
    contains: function (c) { return clases.indexOf(c) >= 0; },
    add: function (c) { if (clases.indexOf(c) < 0) clases.push(c); },
    remove: function (c) { clases = clases.filter(function (x) { return x !== c; }); },
    toggle: function (c, forzar) {
      var poner = forzar === undefined ? clases.indexOf(c) < 0 : !!forzar;
      if (poner) this.add(c); else this.remove(c);
      return poner;
    }
  };
}
Nodo.prototype.addEventListener = function (tipo, f) { this.oyentes.push({ tipo: tipo, f: f }); };
Nodo.prototype.setAttribute = function (k, v) { this.attrs[k] = String(v); };
Nodo.prototype.getAttribute = function (k) { return this.attrs[k] === undefined ? null : this.attrs[k]; };
Nodo.prototype.todos = function () {
  var salida = [];
  (function bajar(x) { x.hijos.forEach(function (h) { salida.push(h); bajar(h); }); })(this);
  return salida;
};
Nodo.prototype.querySelectorAll = function (sel) {
  var m = /^(\.?)([\w-]+)(?:\[([\w-]+)="([^"]*)"\])?$/.exec(sel);
  if (!m) throw new Error('selector no soportado: ' + sel);
  return this.todos().filter(function (x) {
    if (m[1] ? !x.classList.contains(m[2]) : x.tagName !== m[2]) return false;
    return !m[3] || x.attrs[m[3]] === m[4];
  });
};
Nodo.prototype.querySelector = function (sel) { return this.querySelectorAll(sel)[0] || null; };
function analizarHtml(raiz, html) {
  raiz.hijos = [];
  var actual = raiz, re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>/g, m;
  while ((m = re.exec(html))) {
    var tag = m[2].toLowerCase();
    if (m[1]) { if (actual.tagName === tag && actual.parent) actual = actual.parent; continue; }
    var attrs = {}, ra = /([\w-]+)="([^"]*)"/g, a;
    while ((a = ra.exec(m[3]))) attrs[a[1]] = desescapar(a[2]);
    var n = new Nodo(tag, attrs, actual);
    actual.hijos.push(n);
    if (!VACIAS[tag]) actual = n;
  }
}
function clic(nodo) {
  var parar = false;
  var evento = { target: nodo, stopPropagation: function () { parar = true; } };
  for (var x = nodo; x && !parar; x = x.parent) {
    x.oyentes.filter(function (o) { return o.tipo === 'click'; }).forEach(function (o) { o.f(evento); });
  }
}
var nodos = {};
var documento = {
  getElementById: function (id) {
    if (!nodos[id]) {
      var n = new Nodo('div', { id: id }, null), html = '';
      Object.defineProperty(n, 'innerHTML', {
        get: function () { return html; },
        set: function (v) { html = String(v); analizarHtml(n, html); }
      });
      nodos[id] = n;
    }
    return nodos[id];
  }
};

// Red: cualquier fetch cuenta. Ninguna interaccion de estas tablas debe pedir.
var pedidos = 0;
global.fetch = function () { pedidos++; return Promise.reject(new Error('sin red en la prueba')); };

var codigo =
  'var TOPE_ANTIGUOS = ' + constante('TOPE_ANTIGUOS') + ';\n' +
  'var ANTIGUOS_INICIAL = ' + constante('ANTIGUOS_INICIAL') + ';\n' +
  'var ANTIGUOS_PASO = ' + constante('ANTIGUOS_PASO') + ';\n' +
  'var visiblesAntiguos = new Map(), lideresAntiguos = [];\n' +
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
  // renderTodo de la prueba: repinta las dos tablas de aqui y cuenta. El
  // real se revisa aparte (abajo) para que no pida nada a la red.
  'var repintados = 0;\n' +
  'function renderTodo() { repintados++; renderTablaAging(); renderAntiguos(); }\n' +
  recortar('alternarFiltro') +
  recortar('porLiderGrupo') + recortar('agingFiltrado') +
  recortar('activarDrillDown') + recortar('construirMatrizAging') +
  recortar('gruposPorAging') + recortar('renderTablaAging') +
  recortar('limpiarDescripcion') + recortar('celdaCodigo') + recortar('tooltipDescripcion') +
  recortar('masViejoPrimero') + recortar('antiguosVisibles') + recortar('antiguosPorLider') +
  recortar('visiblesDe') + recortar('verMasAntiguos') + recortar('renderAntiguos') +
  '\nreturn { filtro: filtro, poner: function (d) { datos = d; },' +
  ' repintados: function () { return repintados; }, visibles: visiblesAntiguos,' +
  ' alternarFiltro: alternarFiltro, activarDrillDown: activarDrillDown,' +
  ' gruposPorAging: gruposPorAging, renderTablaAging: renderTablaAging,' +
  ' antiguosVisibles: antiguosVisibles, antiguosPorLider: antiguosPorLider,' +
  ' renderAntiguos: renderAntiguos, masViejoPrimero: masViejoPrimero };';
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

// --------------------------------------- Resumen por antiguedad: clics
// La flecha y las cifras despliegan (misma accion), solo el nombre filtra, el
// fondo de la fila no hace nada. Filtrar repinta en memoria: ningun fetch.
limpiarFiltro();
T.poner({ resumen: { aging: aging }, antiguos: {} });
T.renderTablaAging();
var tablaAg = nodos['tabla-aging-bl'];
function filaCubo(k) { return tablaAg.querySelectorAll('.n1row')[k]; }
function hijosCubo(k) { return tablaAg.querySelectorAll('.n2row').filter(function (h) { return h.dataset.p1 === String(k); }); }
function abiertos(k) { return hijosCubo(k).filter(function (h) { return h.classList.contains('show'); }).length; }
var f0 = filaCubo(0), flecha0 = f0.querySelector('.flecha-dd'), nombre0 = f0.querySelector('.filtrable');
var cubo0 = nombre0.dataset.valor;
var rep0 = T.repintados(), red0 = pedidos;

Check('cada cubo tiene un boton de flecha', tablaAg.querySelectorAll('.n1row').length,
  tablaAg.querySelectorAll('.flecha-dd').length);
Check('flecha: es un <button>', 'button', flecha0.tagName);
clic(flecha0);
Check('flecha: despliega los grupos del cubo', hijosCubo(0).length, abiertos(0));
Check('flecha: la fila queda .open', true, f0.classList.contains('open'));
Check('flecha: aria-expanded=true', 'true', flecha0.getAttribute('aria-expanded'));
Check('flecha: no filtra', null, T.filtro.aging);
Check('flecha: no repinta el tablero', rep0, T.repintados());
Check('flecha: solo ese cubo', 0, abiertos(1));
clic(flecha0);
Check('flecha otra vez: pliega', 0, abiertos(0));
Check('flecha otra vez: aria-expanded=false', 'false', flecha0.getAttribute('aria-expanded'));

// Cifras del cubo: las de cada lider y la del Total. Hacen lo MISMO que la
// flecha: desplegar / plegar, nunca filtrar.
var celdasNum = f0.querySelectorAll('td').filter(function (td) { return td.classList.contains('num'); });
var cifrasLider = celdasNum.slice(0, -1).filter(function (td) { return td.classList.contains('dd-cifra'); });
var celdaTotal = celdasNum[celdasNum.length - 1];
var vaciasLider = celdasNum.slice(0, -1).filter(function (td) { return !td.classList.contains('dd-cifra'); });
Check('la fila tiene cifras de lider', true, cifrasLider.length > 0);
Check('Total del cubo marcado .dd-cifra', true, celdaTotal.classList.contains('dd-cifra'));
// Celda de lider sin tickets: sin .dd-cifra (es fondo) y vacia en el HTML.
var filasCuboHtml = tablaAg.innerHTML.split('<tr class="n1row').slice(1).map(function (x) { return x.slice(0, x.indexOf('</tr>')); });
Check('fila de cubo: toda cifra lleva .dd-cifra; sin cifra, celda vacia', true,
  filasCuboHtml.every(function (x) { return !/<td class="num">[^<]/.test(x); }));
// Un lider sin tickets en un cubo: su celda va vacia, sin .dd-cifra.
T.poner({ resumen: { aging: [{ Aging: '1-7 dias', AgingSort: 2, Lider: 'Ana', Grupo: 'Ana / G0', Tickets: 3 },
  { Aging: '+1 mes', AgingSort: 5, Lider: 'Beto', Grupo: 'Beto / G0', Tickets: 4 }] }, antiguos: {} });
T.renderTablaAging();
var celdasMini = nodos['tabla-aging-bl'].querySelectorAll('.n1row')[0].querySelectorAll('td');
Check('lider sin tickets en el cubo: celda sin .dd-cifra', 'true|false|true',
  [1, 2, 3].map(function (k) { return celdasMini[k].classList.contains('dd-cifra'); }).join('|'));
T.poner({ resumen: { aging: aging }, antiguos: {} });
T.renderTablaAging();
tablaAg = nodos['tabla-aging-bl']; f0 = filaCubo(0); flecha0 = f0.querySelector('.flecha-dd'); nombre0 = f0.querySelector('.filtrable');
celdasNum = f0.querySelectorAll('td').filter(function (td) { return td.classList.contains('num'); });
cifrasLider = celdasNum.slice(0, -1).filter(function (td) { return td.classList.contains('dd-cifra'); });
celdaTotal = celdasNum[celdasNum.length - 1];
vaciasLider = celdasNum.slice(0, -1).filter(function (td) { return !td.classList.contains('dd-cifra'); });
function probarCifra(nombre, td, blanco) {
  clic(blanco || td);
  Check(nombre + ': despliega los grupos del cubo', hijosCubo(0).length, abiertos(0));
  Check(nombre + ': fila .open y aria-expanded=true', 'true|true', f0.classList.contains('open') + '|' + flecha0.getAttribute('aria-expanded'));
  Check(nombre + ': no filtra', null, T.filtro.aging);
  Check(nombre + ': no repinta el tablero', rep0, T.repintados());
  Check(nombre + ': ningun fetch', red0, pedidos);
  Check(nombre + ': solo ese cubo', 0, abiertos(1));
  clic(blanco || td);
  Check(nombre + ' otra vez: pliega', 0, abiertos(0));
  Check(nombre + ' otra vez: aria-expanded=false', 'false', flecha0.getAttribute('aria-expanded'));
  Check(nombre + ' otra vez: no filtra', null, T.filtro.aging);
}
probarCifra('cifra de lider (primera)', cifrasLider[0]);
probarCifra('cifra de lider (ultima)', cifrasLider[cifrasLider.length - 1]);
probarCifra('cifra Total', celdaTotal);
probarCifra('cifra Total, clic sobre su <b>', celdaTotal, celdaTotal.querySelector('b'));
// Flecha y cifra comparten estado: abrir con una, cerrar con la otra.
clic(flecha0); clic(celdaTotal);
Check('flecha abre, cifra cierra', '0|false', abiertos(0) + '|' + flecha0.getAttribute('aria-expanded'));
clic(cifrasLider[0]); clic(flecha0);
Check('cifra abre, flecha cierra', '0|false', abiertos(0) + '|' + flecha0.getAttribute('aria-expanded'));
// En todas las filas de cubo, cada Total despliega SU cubo.
tablaAg.querySelectorAll('.n1row').forEach(function (f, k) {
  var c = f.querySelectorAll('.dd-cifra');
  clic(c[c.length - 1]);
  Check('[' + f.querySelector('.filtrable').dataset.valor + '] su Total despliega su cubo', hijosCubo(k).length, abiertos(k));
  clic(c[c.length - 1]);
});

// Fondo: la fila, la celda del nombre fuera de la etiqueta y las celdas
// vacias de lider no hacen nada.
// Cada clic por separado: dos clics seguidos se anularian entre si.
[['la fila', f0], ['la celda del nombre', f0.querySelectorAll('td')[0]]].concat(
  vaciasLider.map(function (td) { return ['celda vacia de lider', td]; })).forEach(function (par) {
  clic(par[1]);
  Check('fondo (' + par[0] + '): no despliega ni filtra', '0|null|false', abiertos(0) + '|' + T.filtro.aging + '|' + f0.classList.contains('open'));
});
Check('fondo de la fila: no despliega', 0, abiertos(0));
Check('fondo de la fila: no filtra', null, T.filtro.aging);
Check('fondo de la fila: no repinta', rep0, T.repintados());
Check('la fila .n1row no tiene listener propio (no toda la fila es clicable)', 0,
  tablaAg.querySelectorAll('.n1row').filter(function (f) { return f.oyentes.length > 0; }).length);
var filaTotal = tablaAg.querySelectorAll('tr').filter(function (tr) {
  return !tr.classList.contains('n1row') && !tr.classList.contains('n2row') && tr.parent.tagName === 'tbody'; })[0];
clic(filaTotal);
filaTotal.querySelectorAll('td').forEach(clic);
Check('fila de total general: no filtra ni despliega', 'null|0', T.filtro.aging + '|' + abiertos(0));
// Las cifras de los grupos desplegados no son .dd-cifra: no pliegan el cubo.
clic(flecha0);
hijosCubo(0)[0].querySelectorAll('td').filter(function (td) { return td.classList.contains('num'); }).forEach(clic);
Check('cifras de un grupo: el cubo sigue abierto, sin filtro', hijosCubo(0).length + '|null',
  abiertos(0) + '|' + T.filtro.aging);
clic(flecha0);

clic(nombre0);
Check('nombre del cubo: filtra todo el tablero por ese cubo', cubo0, T.filtro.aging);
Check('nombre del cubo: repinta una vez, en memoria', rep0 + 1, T.repintados());
Check('nombre del cubo: ningun fetch', red0, pedidos);
Check('nombre del cubo: no despliega', 0, abiertos(0));
Check('nombre del cubo: tampoco abre la fila filtrada', false,
  nodos['tabla-aging-bl'].querySelectorAll('.n1row')[0].classList.contains('open'));
var tablaAg2 = nodos['tabla-aging-bl'];
Check('filtro activo: queda una fila de cubo, marcada', 'fila-sel',
  tablaAg2.querySelectorAll('.n1row').length === 1 && tablaAg2.querySelectorAll('.n1row')[0].classList.contains('fila-sel') ? 'fila-sel' : 'no');
clic(tablaAg2.querySelector('.filtrable'));
Check('nombre otra vez: quita el filtro (misma semantica de alternarFiltro)', null, T.filtro.aging);
Check('quitar filtro: ningun fetch', red0, pedidos);
// El grupo dentro del cubo sigue filtrando por grupo.
T.renderTablaAging();
var nombreGrupo = nodos['tabla-aging-bl'].querySelectorAll('.n2row')[0].querySelector('.filtrable');
var redG = pedidos;
clic(nombreGrupo);
Check('nombre de grupo en el drill-down: filtra por grupo', nombreGrupo.dataset.valor, T.filtro.grupo);
Check('nombre de grupo: no toca el filtro de antiguedad', null, T.filtro.aging);
Check('nombre de grupo: ningun fetch', redG, pedidos);
limpiarFiltro();

// "Lideres (drill-down)" sigue igual: sin soloFlecha, toda la fila .n1row
// despliega y el nombre filtra sin desplegar. Mismo activarDrillDown real.
var lid = documento.getElementById('tabla-lideres-prueba');
lid.innerHTML = '<table><tbody><tr class="n1row" data-n1="0"><td><span class="swatch"></span>' +
  '<span class="filtrable" data-dim="lider" data-valor="Ana">Ana</span></td><td class="num">7</td></tr>' +
  '<tr class="n2row" data-p1="0"><td><span class="filtrable" data-dim="grupo" data-valor="Ana / G0">Ana / G0</span></td>' +
  '<td class="num">7</td></tr></tbody></table>';
T.activarDrillDown(lid);
var filaL = lid.querySelector('.n1row'), hijoL = lid.querySelector('.n2row');
clic(filaL.querySelectorAll('td')[1]);
Check('Lideres: clic en una cifra despliega (como antes)', true, hijoL.classList.contains('show'));
clic(filaL);
Check('Lideres: clic en el fondo pliega (como antes)', false, hijoL.classList.contains('show'));
var repL = T.repintados();
clic(filaL.querySelector('.filtrable'));
Check('Lideres: el nombre filtra por lider', 'Ana', T.filtro.lider);
Check('Lideres: el nombre repinta en memoria', repL + 1, T.repintados());
limpiarFiltro();

// renderTodo y alternarFiltro reales: repintan, no piden nada.
function cuerpo(nombre) {
  var ini = fuente.indexOf('\n  function ' + nombre + '(');
  return fuente.slice(ini, fuente.indexOf('\n  }\n', ini));
}
['renderTodo', 'alternarFiltro', 'renderTablaAging', 'activarDrillDown', 'renderAntiguos'].forEach(function (f) {
  Check(f + ' (real) no llama a fetch / obtenerJSON / cargarTodo / programarCarga', false,
    /fetch\(|obtenerJSON|cargarTodo|programarCarga/.test(cuerpo(f)));
});
Check('Lideres (drill-down) sigue con la fila entera desplegable', true,
  /activarDrillDown\(cont\);/.test(cuerpo('renderLideres')));

// ------------------------------------------------------- Tickets mas antiguos
Check('TOPE_ANTIGUOS', 100, constante('TOPE_ANTIGUOS'));
Check('ANTIGUOS_INICIAL', 10, constante('ANTIGUOS_INICIAL'));
Check('ANTIGUOS_PASO', 25, constante('ANTIGUOS_PASO'));

// Tres lideres con mas de 100 tickets y uno con pocos: el servidor manda
// hasta 100 por lider (y por prioridad), aqui se simula un corte mas grande.
var tickets = [];
var lideresT = ['Ana', 'Beto', 'Caro', 'Sin Torre'];
var prios = ['Critica', 'Alta', 'Media', 'Baja'];
for (var i = 0; i < 430; i++) {
  var lider = i < 420 ? lideresT[i % 3] : 'Sin Torre';
  var dia = 1 + ((i * 37) % 300);
  var f = i % 53 === 0 ? null : '2025-' + String(1 + Math.floor(dia / 28) % 12).padStart(2, '0') + '-' +
    String(1 + dia % 28).padStart(2, '0') + 'T08:00:00';
  tickets.push({ CodigoTicket: 'INC' + String(1000 - i).padStart(5, '0'), FechaRegistro: f,
    Lider: lider, Grupo: lider + ' / G' + (i % 2), Prioridad: prios[(i >> 2) % 4],
    DiasBacklog: 0, Titulo: 't', Descripcion: '' });
}
function claveOrden(t) { return (t.FechaRegistro || '￿') + '|' + t.CodigoTicket; }
var esperado = tickets.slice().sort(function (x, y) { return claveOrden(x) < claveOrden(y) ? -1 : 1; });
function codigos(l) { return l.map(function (t) { return t.CodigoTicket; }).join(','); }
function esperadoDe(campo, valor) { return esperado.filter(function (t) { return t[campo] === valor; }); }

// Orden: fecha ascendente, empate por codigo, sin fecha al final.
Check('empate de fecha: decide el codigo (estable)', -1,
  T.masViejoPrimero({ FechaRegistro: '2025-01-01T08:00:00', CodigoTicket: 'INC1' }, { FechaRegistro: '2025-01-01T08:00:00', CodigoTicket: 'INC2' }));
Check('sin fecha va al final', 1, T.masViejoPrimero({ FechaRegistro: null, CodigoTicket: 'A' }, { FechaRegistro: '2030-01-01', CodigoTicket: 'B' }));

limpiarFiltro();
var grupos = T.antiguosPorLider(tickets, 100);
Check('una lista por lider', 'Ana|Beto|Caro|Sin Torre', grupos.map(function (g) { return g[0]; }).join('|'));
grupos.forEach(function (g) {
  var esp = esperadoDe('Lider', g[0]).slice(0, 100);
  Check('[' + g[0] + '] sus 100 mas antiguos, en orden (fecha, codigo, sin fecha al final)', codigos(esp), codigos(g[1]));
});
Check('tope POR LIDER, no global: total listado > 100', true,
  grupos.reduce(function (s, g) { return s + g[1].length; }, 0) > 100);
Check('lider con pocos: salen todos', 10, grupos[3][1].length);
Check('mismo resultado con la entrada al reves', JSON.stringify(grupos.map(function (g) { return codigos(g[1]); })),
  JSON.stringify(T.antiguosPorLider(tickets.slice().reverse(), 100).map(function (g) { return codigos(g[1]); })));
var conNulos = grupos[0][1].map(function (t) { return !t.FechaRegistro; });
Check('sin fecha solo al final de su lista', true, conNulos.every(function (x, k) { return !x || conNulos.slice(k).every(Boolean); }));

// Pintado: 10 por lider al abrir.
T.visibles.clear();
T.poner({ resumen: { aging: [] }, antiguos: { tickets: tickets, total: 4321 } });
T.renderAntiguos();
var contA = nodos['tabla-antiguos-bl'];
function tarjetas() { return nodos['tabla-antiguos-bl'].querySelectorAll('.antiguos-lider'); }
function filasDe(k) { return tarjetas()[k].querySelector('tbody').querySelectorAll('tr'); }
function botonDe(k) { return tarjetas()[k].querySelector('.ver-mas-antiguos'); }
Check('una tarjeta por lider', 4, tarjetas().length);
Check('no hay lista global (sin columna Lider)', false, /<th>Lider<\/th>/.test(contA.innerHTML));
[0, 1, 2].forEach(function (k) { Check('[' + grupos[k][0] + '] abre con 10 filas', 10, filasDe(k).length); });
Check('[Sin Torre] tiene 10: sin boton', null, botonDe(3));
Check('primera fila de Ana = su mas antiguo', true,
  contA.innerHTML.indexOf(esperadoDe('Lider', 'Ana')[0].CodigoTicket) < contA.innerHTML.indexOf(esperadoDe('Lider', 'Ana')[1].CodigoTicket));
Check('pie con el total del corte', true, /4321/.test(nodos['cap-antiguos-bl'].innerHTML));
Check('rotulo del boton', 'Ver 25 m&aacute;s', /<button[^>]*class="ver-mas-antiguos"[^>]*>([^<]*)</.exec(contA.innerHTML)[1]);

// "Ver 25 mas": solo ese lider, sin red, sin renderTodo.
var red1 = pedidos, rep1 = T.repintados();
clic(botonDe(1));                                       // Beto: 35
Check('Ver 25 mas: Beto pasa a 35', 35, filasDe(1).length);
Check('Ver 25 mas: Ana sigue en 10', 10, filasDe(0).length);
Check('Ver 25 mas: Caro sigue en 10', 10, filasDe(2).length);
Check('Ver 25 mas: ningun fetch', red1, pedidos);
Check('Ver 25 mas: no repinta el tablero (renderTodo)', rep1, T.repintados());
var htmlBeto = nodos['tabla-antiguos-bl'].innerHTML;
Check('Beto: las 35 son sus 35 mas antiguas, en orden', true,
  esperadoDe('Lider', 'Beto').slice(0, 35).every(function (t, k, l) {
    return k === 0 || htmlBeto.indexOf(l[k - 1].CodigoTicket) < htmlBeto.indexOf(t.CodigoTicket); }) &&
  htmlBeto.indexOf(esperadoDe('Lider', 'Beto')[35].CodigoTicket) < 0);
var pasos = [];
for (var c = 0; c < 6; c++) { if (botonDe(1)) clic(botonDe(1)); pasos.push(filasDe(1).length); }
Check('Beto: 35 -> 60 -> 85 -> 100 y se queda', '60,85,100,100,100,100', pasos.join(','));
Check('Beto en 100: sin boton', null, botonDe(1));
Check('Beto nunca pasa de 100', 100, T.visibles.get('Beto'));
Check('Ana sigue en 10 tras todo', 10, filasDe(0).length);
clic(botonDe(0));
Check('Ana a 35 mientras Beto sigue en 100', '35|100|10', [filasDe(0).length, filasDe(1).length, filasDe(2).length].join('|'));
Check('ningun fetch en toda la expansion', red1, pedidos);

// Filtros del tablero (cross-filter en memoria): lider, grupo, prioridad.
limpiarFiltro(); T.visibles.clear();
clic(nodos['tabla-antiguos-bl'].querySelector('.ver-mas-antiguos'));   // Ana a 35
T.filtro.lider = 'Caro'; T.renderAntiguos();
Check('filtro lider: solo la tarjeta de Caro', 1, tarjetas().length);
Check('filtro lider: Caro abre en 10', 10, filasDe(0).length);
Check('filtro lider: sus mas antiguos', codigos(esperadoDe('Lider', 'Caro').slice(0, 10)),
  codigos(T.antiguosPorLider(tickets, 100)[0][1].slice(0, 10)));
T.filtro.lider = null; T.renderAntiguos();
Check('quitar filtro: Ana conserva sus 35', 35, filasDe(0).length);

['grupo', 'prioridad'].forEach(function (dim) {
  limpiarFiltro();
  var campo = { grupo: 'Grupo', prioridad: 'Prioridad' }[dim];
  var valor = tickets[5][campo];
  T.filtro[dim] = valor;
  var g = T.antiguosPorLider(tickets, 100);
  Check('filtro ' + dim + '=' + valor + ': cada lider con sus mas antiguos de ese ' + dim, true,
    g.every(function (x) {
      return codigos(x[1]) === codigos(esperado.filter(function (t) { return t[campo] === valor && t.Lider === x[0]; }).slice(0, 100));
    }) && g.length > 0);
});

// Drill-down de lider: el clic en el nombre filtra y Antiguos se reduce a ese
// lider, sin red.
limpiarFiltro();
var red2 = pedidos;
T.filtro.lider = null;
T.poner({ resumen: { aging: aging }, antiguos: { tickets: tickets, total: 4321 } });
T.alternarFiltro('lider', 'Beto');   // lo que hace el .filtrable de Lideres
Check('drill-down lider: Antiguos muestra solo a Beto', 1, tarjetas().length);
Check('drill-down lider: ningun fetch', red2, pedidos);
limpiarFiltro();

T.poner({ resumen: { aging: [] }, antiguos: { tickets: [], total: 0 } });
T.renderAntiguos();
Check('sin tickets: mensaje vacio', true, /class="vacio"/.test(nodos['tabla-antiguos-bl'].innerHTML));

// Las cifras del cubo se comportan como la flecha, no como texto: no se
// seleccionan, no se subrayan y al pasar el raton encienden la flecha.
var css = fs.readFileSync(path.join(raiz, 'backlog', 'backlog.css'), 'utf8');
var reglaCifra = (/\.n1row\.dd-flecha \.dd-cifra \{([^}]*)\}/.exec(css) || [])[1] || '';
Check('cifras: user-select none', true, /(^|[^-])user-select:\s*none/.test(reglaCifra));
Check('cifras: cursor de mano', true, /cursor:\s*pointer/.test(reglaCifra));
Check('cifras: sin subrayado', false, /\.dd-cifra[^{]*\{[^}]*text-decoration/.test(css));
Check('cifras: hover enciende la flecha', true, /:has\(\.dd-cifra:hover\) \.flecha-dd/.test(css));

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo PASS');
process.exit(fallos ? 1 : 0);
