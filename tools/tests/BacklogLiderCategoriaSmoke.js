// tools/tests/BacklogLiderCategoriaSmoke.js - prueba de humo de las pestañas
// "Líder (Grupo)" y "Líder (Categoría)" del tablero de Backlog.
//
//   - el marcado tiene las dos pestañas con su nombre nuevo y sus paneles;
//   - cargarTodo pide backlog_categorias.ashx con los mismos filtros, y su
//     fallo no tumba el tablero;
//   - con los MISMOS tickets, la fila de cada lider en "Líder (Categoría)"
//     muestra las mismas cifras que en "Líder (Grupo)" (Tickets, %, Criticos,
//     Altos, +30 dias, % Fuera SLA);
//   - el arbol Lider -> C1 -> subniveles sale de las rutas de Categoria:
//     cada padre suma exactamente sus hijos (con la fila "(sin
//     subcategoría)" para lo registrado en el padre mismo), a varios niveles,
//     las hojas de un lider suman su total (ningun ticket dos veces) y
//     variantes de mayusculas / espacios de una ruta caen en el mismo nodo;
//   - una ruta que no empieza por su C1 se queda en el nivel C1;
//   - todo nace plegado y las ramas abiertas siguen abiertas al repintar;
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
  'function activarArbolCategoria() {}',
  'function abrirTicketsCat() {}',
  'function alternarFiltro() {}',
  'function descripcionFiltro(n) { return String(n); }',
  recortar('porLiderGrupo', '  '),
  recortar('renderLideres', '  '),
  recortar('segmentosCategoria', '  '),
  recortar('arbolCategorias', '  '),
  linea('const abiertosCat ='), linea('let ticketsCat ='), linea('let pedidoTicketsCat ='),
  recortar('cerrarTicketsCat', '  '),
  recortar('renderLideresCategoria', '  '),
  'return { filtro: filtro, abiertos: abiertosCat, segmentos: segmentosCategoria, poner: function (d) { datos = d; }, renderLideres: renderLideres, renderLideresCategoria: renderLideresCategoria };'
].join('\n');
var B = (new Function('document', codigo))(documento);

// Tickets sinteticos -> los result sets del procedimiento y las filas del
// handler nuevo, cada uno con SU agregacion (como en SQL).
var lideres = ['Laura', 'Jesus', 'Sin Torre'], c1s = ['S-Punto de Venta', 'S-Logistica', null];
// Rutas por C1: varios niveles, una ruta que acaba en un nodo intermedio,
// variantes de mayusculas / espacios / '/' final, y una que no empieza por su C1.
var rutas = {
  'S-Punto de Venta': ['/S-Punto de Venta/Aplicativo/Caja', '/S-Punto de Venta/Aplicativo',
    '/S-Punto de Venta/Hardware/Impresora/Termica', '/S-Punto de Venta/Hardware/Impresora/Laser',
    '/S-Punto de Venta', ' /s-punto de venta / aplicativo /Caja/', '/Otra Cosa/Aplicativo'],
  'S-Logistica': ['/S-Logistica/CEDIS', '/S-Logistica/CEDIS/Andenes', 'S-Logistica/Transporte'],
  'null': [null, '/Algo/Sin C1'],
};
var pris = ['Critica', 'Alta', 'Media', 'Baja'], slas = ['Dentro SLA', 'Fuera SLA', null];
var tickets = [], semilla = 11;
function azar(n) { semilla = (semilla * 9301 + 49297) % 233280; return Math.floor(semilla / 233280 * n); }
for (var i = 0; i < 300; i++) {
  var l = lideres[azar(3)], c = c1s[azar(3)], rs = rutas[String(c)];
  tickets.push({ Lider: l, Grupo: l + '-G' + azar(3), C1: c, Categoria: rs[azar(rs.length)], Prioridad: pris[azar(4)],
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
var categorias = { filas: agrupar(['Lider', 'Grupo', 'C1', 'Categoria'], function (o, t) {
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
// Todas las filas del arbol: id, padre, clases, nombre y Tickets.
function arbol(html) {
  return html.split('<tr class="').slice(1).map(function (tr) {
    tr = tr.slice(0, tr.indexOf('</tr>'));
    var clases = tr.slice(0, tr.indexOf('"')).split(/\s+/);
    var id = (/data-id="([^"]*)"/.exec(tr) || [])[1];
    var p = (/data-p="([^"]*)"/.exec(tr) || [])[1] || null;
    var celdas = tr.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
    var nombre = celdas[0].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    var total = Number(celdas[1].replace(/<[^>]+>/g, '').replace(/[^\d]/g, ''));
    return { id: id, p: p, clases: clases, nombre: nombre, total: total };
  });
}
function hijosDe(filas, id) { return filas.filter(function (f) { return f.p === id; }); }
// Padres cuya cifra no es la suma de sus hijos (vacio = todo cuadra).
function descuadres(filas) {
  return filas.filter(function (f) { return hijosDe(filas, f.id).length; }).filter(function (f) {
    return hijosDe(filas, f.id).reduce(function (a, h) { return a + h.total; }, 0) !== f.total;
  }).map(function (f) { return f.nombre; });
}
function raizDe(filas, f) { while (f.p) f = filas.filter(function (x) { return x.id === f.p; })[0]; return f; }
function profundidad(filas, f) { var d = 0; while (f.p) { f = filas.filter(function (x) { return x.id === f.p; })[0]; d++; } return d; }
function camino(filas, nombres) {
  var actual = null;
  nombres.forEach(function (n) {
    actual = filas.filter(function (f) { return f.p === (actual ? actual.id : null) && f.nombre === n; })[0] || { id: '?' };
  });
  return actual;
}
function pintar() {
  B.renderLideres(); B.renderLideresCategoria();
  return [nodos['tabla-lideres-bl'].innerHTML, nodos['tabla-lideres-cat-bl'].innerHTML];
}

B.poner({ resumen: resumen, categorias: categorias });
var t = pintar();
Check('sin filtro: las filas de lider son identicas en las dos pestañas', filasLider(t[0]), filasLider(t[1]));
Check('sin filtro: 3 lideres', 3, filasLider(t[1]).length);
var A = arbol(t[1]);
var raices = A.filter(function (f) { return f.p === null; });
var esDe = function (lider, f) { return f.Lider === lider; };
Check('C1 NULL -> "(sin categoría)", nunca "null"', [true, false],
  [A.some(function (f) { return f.nombre === '(sin categoría)'; }), A.some(function (f) { return /null/.test(f.nombre); })]);
Check('cada padre suma exactamente sus hijos, a cualquier nivel', [], descuadres(A));
Check('las hojas de cada lider suman su total: ningun ticket dos veces', raices.map(function (r) { return r.total; }),
  raices.map(function (r) {
    return A.filter(function (f) { return f.p !== null && !hijosDe(A, f.id).length && raizDe(A, f).id === r.id; })
      .reduce(function (a, f) { return a + f.total; }, 0);
  }));
Check('suma de lideres = tickets del corte', tickets.length, raices.reduce(function (a, r) { return a + r.total; }, 0));
var termica = camino(A, ['Laura', 'S-Punto de Venta', 'Hardware', 'Impresora', 'Termica']);
Check('cuatro niveles bajo el lider: Lider > C1 > Hardware > Impresora > Termica', [true, 4], [termica.id !== '?', profundidad(A, termica)]);
Check('Termica cuenta sus tickets',
  tickets.filter(function (x) { return esDe('Laura', x) && x.Categoria === '/S-Punto de Venta/Hardware/Impresora/Termica'; }).length,
  termica.total);
var caja = camino(A, ['Laura', 'S-Punto de Venta', 'Aplicativo', 'Caja']);
Check('variantes de mayusculas/espacios/"/" final caen en el mismo nodo Caja',
  tickets.filter(function (x) { return esDe('Laura', x) && x.C1 === 'S-Punto de Venta' && /caja/i.test(x.Categoria || ''); }).length,
  caja.total);
var pdv = camino(A, ['Laura', 'S-Punto de Venta']);
var aplic = camino(A, ['Laura', 'S-Punto de Venta', 'Aplicativo']);
Check('Aplicativo: un solo nodo, con su fila "(sin subcategoría)"', [1, true],
  [hijosDe(A, pdv.id).filter(function (f) { return f.nombre === 'Aplicativo'; }).length,
   hijosDe(A, aplic.id).some(function (f) { return f.nombre === '(sin subcategoría)' && f.clases.indexOf('cat-directo') >= 0; })]);
Check('ruta que no empieza por su C1: se queda en el nivel C1 ("(sin subcategoría)" del C1)',
  tickets.filter(function (x) { return esDe('Laura', x) && x.C1 === 'S-Punto de Venta' &&
    (x.Categoria === '/S-Punto de Venta' || x.Categoria === '/Otra Cosa/Aplicativo'); }).length,
  (hijosDe(A, pdv.id).filter(function (f) { return f.nombre === '(sin subcategoría)'; })[0] || { total: -1 }).total);
Check('sin C1: hoja, sin subniveles aunque traiga ruta', 0,
  hijosDe(A, camino(A, ['Laura', '(sin categoría)']).id).length);
Check('la nota avisa de las rutas que no empiezan por su C1', true, /no empieza por su C1/.test(nodos['cap-lideres-cat-bl'].innerHTML));
Check('todo nace plegado: ninguna fila de categoria visible ni abierta', [0, 0],
  [A.filter(function (f) { return f.clases.indexOf('show') >= 0; }).length, A.filter(function (f) { return f.clases.indexOf('open') >= 0; }).length]);
Check('hojas sin enlace: solo los nodos con hijos abren tickets', [0, true],
  [(t[1].match(/<tr class="n2row cat-nodo(?! n2exp)[^>]*>\s*<td[^>]*>[^<]*<span class="filtrable/g) || []).length,
   /<tr class="n2row cat-nodo n2exp[^>]*>\s*<td[^>]*><span class="filtrable ver-tickets"/.test(t[1])]);
Check('flecha (n2exp) solo en nodos con hijos', [],
  A.filter(function (f) { return f.p && (f.clases.indexOf('n2exp') >= 0) !== (hijosDe(A, f.id).length > 0); }).map(function (f) { return f.nombre; }));
// Ramas abiertas (por clave) sobreviven al repintado: Laura y su S-Punto de Venta.
B.abiertos.add(JSON.stringify(['Laura', '', '']));
B.abiertos.add(JSON.stringify(['Laura', 's-punto de venta', '']));
A = arbol(pintar()[1]);
pdv = camino(A, ['Laura', 'S-Punto de Venta']);
var hw = camino(A, ['Laura', 'S-Punto de Venta', 'Hardware']);
Check('repintado: Laura y S-Punto de Venta abiertos; sus hijos visibles; los de Hardware no', [true, true, true, false],
  [camino(A, ['Laura']).clases.indexOf('open') >= 0,
   pdv.clases.indexOf('open') >= 0 && pdv.clases.indexOf('show') >= 0,
   hijosDe(A, pdv.id).every(function (f) { return f.clases.indexOf('show') >= 0; }),
   hijosDe(A, hw.id).some(function (f) { return f.clases.indexOf('show') >= 0; })]);
B.abiertos.delete(JSON.stringify(['Laura', '', '']));
A = arbol(pintar()[1]);
Check('lider plegado con la rama abierta debajo: nada de la rama se ve', 0,
  A.filter(function (f) { return f.clases.indexOf('show') >= 0; }).length);
B.abiertos.clear();
Check('segmentosCategoria: "/" inicial opcional, recorte, "/" finales y C1 sin mayusculas',
  [['A', 'B'], ['A'], [], false],
  [B.segmentos('/X/A/B', 'X').sub, B.segmentos(' x / A /', 'X').sub, B.segmentos('/X', 'X').sub, B.segmentos('/Y/A', 'X').coincide]);
Check('encabezado "Líder / Categoría"', true, t[1].indexOf('<th>Líder / Categoría</th>') >= 0);

B.filtro.lider = 'Jesus';
t = pintar();
Check('cross-filter lider: siguen saliendo todos y las cifras cuadran', filasLider(t[0]), filasLider(t[1]));
B.filtro.lider = null; B.filtro.grupo = 'Laura-G1';
t = pintar();
Check('cross-filter grupo: solo Laura y las cifras cuadran', [filasLider(t[0]), 1], [filasLider(t[1]), filasLider(t[1]).length]);
Check('cross-filter grupo: el arbol sigue cuadrando', [], descuadres(arbol(t[1])));
Check('cross-filter grupo: el lider suma solo los tickets del grupo',
  tickets.filter(function (x) { return x.Grupo === 'Laura-G1'; }).length, arbol(t[1])[0].total);
B.filtro.grupo = null;

B.poner({ resumen: resumen, categorias: { error: 'HTTP 500 <x>' } });
t = pintar();
Check('handler caido: mensaje en la pestaña, escapado; "Líder (Grupo)" se pinta igual', [true, 3],
  [t[1].indexOf('No se pudo leer el backlog por categoría: HTTP 500 &lt;x>') >= 0, filasLider(t[0]).length]);
B.poner({ resumen: resumen, categorias: { filas: [] } });
Check('sin filas: vacio', true, pintar()[1].indexOf('Sin datos para este corte.') >= 0);

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
