// tools/tests/IniciativasBarrasExperienciaSmoke.js - las graficas de
// iniciativas de Experiencia en "Retrasadas / vencidas" y "Activas":
//
//   - "<Vencidas|Activas> por Director / Product Owner" y "... por Agrupador"
//     se pintan como BARRAS (Chart.js via DashboardBarChart), ya no como
//     treemap: Director/PO acostadas, Agrupador de pie; "... por Estado"
//     sigue siendo la misma grafica de barras;
//   - mismos conteos que antes (filas base + aplicarFiltroGraf), de mayor a
//     menor y sin ceros;
//   - clic en una barra = el mismo toggleFiltroGraf que hacia el recuadro del
//     treemap (dimVal / agrup / estado), y clic otra vez lo quita;
//   - "Resetear filtro de graficas" deja los conteos completos;
//   - nombres largos: el eje los parte en renglones y el tooltip y el clic
//     usan el nombre completo;
//   - el tamaño no se fija a mano: responsive + maintainAspectRatio false,
//     dentro de la caja .lienzo-ini de experiencia.html, con el mismo id.
//
// NO forma parte del sitio. Recorta las funciones del propio experiencia.js y
// las corre con Chart.js de mentira (captura la config) y el DashboardBarChart
// REAL de assets/js/grafica.js. Lo que esta prueba no puede ver -medidas de
// verdad en el navegador al abrir la pestaña, embebido en dashboard.html y al
// cambiar el ancho- se comprueba en el navegador; aqui solo se fija que nada
// fuerza un tamaño.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\IniciativasBarrasExperienciaSmoke.js   # PASS/FAIL, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) {
  return fs.readFileSync(path.join(raiz, rel), 'utf8').split(String.fromCharCode(13)).join('');
}
var fuente = leer('experiencia/experiencia.js');
var html = leer('experiencia/experiencia.html');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

function recortar(nombre) {
  var ini = fuente.indexOf('\nfunction ' + nombre + '(');
  if (ini < 0) { console.log('FAIL  ' + nombre + ' no esta en experiencia.js'); process.exit(1); }
  var fin = fuente.indexOf('\n}\n', ini);
  return fuente.slice(ini, fin + 3);
}
function linea(re, que) {
  var m = re.exec(fuente);
  if (!m) { console.log('FAIL  ' + que + ' no esta en experiencia.js'); process.exit(1); }
  return m[0] + '\n';
}

// ---------------------------------------------------- Chart.js de mentira
var vivas = [];
function Chart(el, cfg) { this.canvas = el; this.config = cfg; this.vivo = true; vivas.push(this); }
Chart.prototype.destroy = function () { this.vivo = false; };
Chart.getChart = function (el) {
  for (var i = vivas.length - 1; i >= 0; i--) if (vivas[i].canvas === el && vivas[i].vivo) return vivas[i];
  return undefined;
};
var ventana = {};
global.window = ventana;
global.Chart = Chart;
['paleta.js', 'barras.js', 'grafica.js'].forEach(function (a) {
  (new Function('window', leer('assets/js/' + a)))(ventana);
});
// grafica.js lee Paleta y Barras por scope global, como en la pagina.
global.Paleta = ventana.Paleta;
global.Barras = ventana.Barras;

// ---------------------------------------------------- DOM de mentira
// Cada canvas vive en .lienzo-ini > .lienzo-ini-alto, como en el HTML.
var elementos = {};
function lienzo(id) {
  var vacio = { hidden: true };
  var caja = { querySelector: function (s) { return s === '.ini-vacio' ? vacio : null; } };
  var interior = { style: {}, classList: { contains: function (c) { return c === 'lienzo-ini-alto'; } } };
  return { id: id, style: {}, parentNode: interior, vacio: vacio,
    closest: function (s) { return s === '.lienzo-ini' ? caja : null; } };
}
['Ven', 'Act'].forEach(function (t) {
  ['Dim', 'Agrup', 'Estado'].forEach(function (g) { elementos['chart' + t + g] = lienzo('chart' + t + g); });
  elementos['tituloDim' + t] = { textContent: '' };
});
var documento = { getElementById: function (id) { return elementos[id] || null; } };

// ---------------------------------------------------- codigo del tablero
var filas = { ven: [], act: [] };
var llamadasTreemap = 0;
var codigo =
  linea(/const ESTADOS_ACTIVOS=\[[^\]]*\];/, 'ESTADOS_ACTIVOS') +
  linea(/const COLOR_ESTADO=\{[^}]*\};/, 'COLOR_ESTADO') +
  linea(/const NOMBRE_DIM_GRAF=\{[^}]*\};/, 'NOMBRE_DIM_GRAF') +
  linea(/const filtroGraf = \{[\s\S]*?\n\};/, 'filtroGraf') +
  linea(/const chartsIniciativa = \{\};/, 'chartsIniciativa') +
  linea(/const ALTO_FILA_INI = \d+;/, 'ALTO_FILA_INI') +
  linea(/let chartsFiltroEstado=\{[^}]*\};/, 'chartsFiltroEstado') +
  'const FMT = n => String(n);\n' +
  linea(/const PCT = [^\n]*;/, 'PCT') +
  'const PALETA_CATEGORICA = Paleta.PALETA_CATEGORICA;\n' +
  'function registrarDimension(n){ Paleta.registrarLideres(n); }\n' +
  'function renderTreemap(){ contarTreemap(); }\n' +
  'function currentCats(){ return null; }\n' +
  'function filasBaseVen(){ return filas.ven; }\n' +
  'function filasBaseAct(){ return filas.act; }\n' +
  'function renderVen(c){ renderPanelGraf("ven", c); }\n' +
  'function renderAct(c){ renderPanelGraf("act", c); }\n' +
  recortar('cap1') + recortar('aplicarFiltroGraf') + recortar('toggleFiltroGraf') +
  recortar('partirNombreEje') + recortar('renderBarrasIniciativa') +
  recortar('renderBarrasFiltroEstado') + recortar('renderPanelGraf') +
  // Los dos "Resetear filtro de graficas", tal cual estan en el archivo.
  linea(/document\.getElementById\('btnResetGrafVen'\)\.onclick=[^\n]*\n[^\n]*\n\};/, 'reset Ven') +
  linea(/document\.getElementById\('btnResetGrafAct'\)\.onclick=[^\n]*\n[^\n]*\n\};/, 'reset Act') +
  '\nreturn { filtroGraf: filtroGraf, renderPanelGraf: renderPanelGraf, partir: partirNombreEje };';
var botones = {};
documento.getElementById = (function (previo) {
  return function (id) {
    if (/^btnResetGraf/.test(id)) return (botones[id] = botones[id] || {});
    return previo(id);
  };
})(documento.getElementById);
var T = (new Function('document', 'Paleta', 'Barras', 'DashboardBarChart', 'filas', 'contarTreemap', codigo))(
  documento, ventana.Paleta, ventana.Barras, ventana.DashboardBarChart, filas, function () { llamadasTreemap++; });

// ---------------------------------------------------- datos
var dirs = ['Directora de Operaciones Comerciales y Experiencia del Cliente', 'Ana Ruiz', 'Beto Diaz', 'Caro Leon'];
var pos = ['PO Uno', 'PO Dos', 'PO Tres'];
var agrs = ['Problem', 'SorIA', 'Mejora'];
var ests = ['En Análisis', 'En Solución', 'En Monitoreo'];
function armar(n, semilla) {
  var r = [];
  for (var i = 0; i < n; i++) {
    r.push({ folio: 'F' + semilla + i, director: i % 11 === 0 ? '' : dirs[(i * 3 + semilla) % 4],
      po: pos[(i + semilla) % 3], agrup: agrs[(i * 7) % 3 === 2 && i % 2 ? 2 : (i % 3)], estado: ests[(i >> 1) % 3] });
  }
  return r;
}
filas.ven = armar(37, 1);
filas.act = armar(90, 2);

function chartDe(id) { return Chart.getChart(elementos[id]); }
function conteo(rows, campo) {
  var c = {};
  rows.forEach(function (r) { var v = campo === 'dim' ? (r.director || '(Sin dato)') : r[campo]; c[v] = (c[v] || 0) + 1; });
  return Object.keys(c).map(function (k) { return [k, c[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
}
function serie(id) {
  // El nombre completo sale del tooltip: el del eje puede venir partido.
  var ch = chartDe(id), titulo = ch.config.options.plugins.tooltip.callbacks.title;
  return ch.config.data.labels.map(function (l, i) {
    return [titulo([{ dataIndex: i }]), ch.config.data.datasets[0].data[i]];
  });
}
function clicBarra(id, k) {
  var ch = chartDe(id);
  ch.config.options.onClick({ native: { target: {} } }, [{ index: k }], ch);
}
function totalDe(id) { return chartDe(id).config.data.datasets[0].data.reduce(function (s, v) { return s + v; }, 0); }

// ---------------------------------------------------- forma
['ven', 'act'].forEach(function (tab) {
  var Tb = tab === 'ven' ? 'Ven' : 'Act', nombre = tab === 'ven' ? 'Vencidas' : 'Activas';
  T.renderPanelGraf(tab, null);
  var cDim = chartDe('chart' + Tb + 'Dim'), cAg = chartDe('chart' + Tb + 'Agrup'), cEs = chartDe('chart' + Tb + 'Estado');
  Check(nombre + ' por Director: es grafica de barras', 'bar', cDim && cDim.config.type);
  Check(nombre + ' por Director: barras acostadas', 'y', cDim.config.options.indexAxis);
  Check(nombre + ' por Agrupador: es grafica de barras', 'bar', cAg && cAg.config.type);
  Check(nombre + ' por Agrupador: barras de pie', 'x', cAg.config.options.indexAxis);
  Check(nombre + ' por Estado: sigue de barras', 'bar', cEs && cEs.config.type);
  Check(nombre + ' por Estado: mismas etiquetas', ests.join('|'), cEs.config.data.labels.join('|'));
  [cDim, cAg].forEach(function (c, k) {
    var q = nombre + (k ? ' por Agrupador' : ' por Director');
    Check(q + ': responsive', true, c.config.options.responsive);
    Check(q + ': sin aspecto fijo (toma el alto de su caja)', false, c.config.options.maintainAspectRatio);
    Check(q + ': cifra dentro (plugin compartido)', true, c.config.plugins.some(function (p) { return p.id === 'valueLabelsDentro'; }));
  });
  Check(nombre + ': ya no se llama a renderTreemap', 0, llamadasTreemap);
  Check(nombre + ' por Director: conteos = filas base, mayor a menor', JSON.stringify(conteo(filas[tab], 'dim')),
    JSON.stringify(serie('chart' + Tb + 'Dim')));
  Check(nombre + ' por Agrupador: conteos = filas base, mayor a menor', JSON.stringify(conteo(filas[tab], 'agrup')),
    JSON.stringify(serie('chart' + Tb + 'Agrup')));
  Check(nombre + ' por Director: color de identidad por nombre completo',
    JSON.stringify(ventana.Paleta.escalaDirectores(conteo(filas[tab], 'dim').map(function (x) { return x[0]; }))),
    JSON.stringify(cDim.config.data.datasets[0].backgroundColor));
  Check(nombre + ' por Agrupador: paleta categorica por posicion, como el treemap',
    JSON.stringify(conteo(filas[tab], 'agrup').map(function (_, i) { return ventana.Paleta.PALETA_CATEGORICA[i]; })),
    JSON.stringify(cAg.config.data.datasets[0].backgroundColor));
  var interior = elementos['chart' + Tb + 'Dim'].parentNode.style.height;
  Check(nombre + ' por Director: el alto interior sale del numero de barras, nunca menos que la caja', true,
    /^max\(100%, \d+px\)$/.test(interior));
});

// ---------------------------------------------------- nombres largos
var largo = dirs[0];
var cV = chartDe('chartVenDim');
var k0 = serie('chartVenDim').map(function (x) { return x[0]; }).indexOf(largo);
Check('nombre largo: el eje lo parte en renglones', true, Array.isArray(cV.config.data.labels[k0]));
Check('nombre largo: ningun renglon pasa de 18', true, cV.config.data.labels[k0].every(function (l) { return l.length <= 18; }));
Check('nombre largo: tooltip con el nombre completo', largo,
  cV.config.options.plugins.tooltip.callbacks.title([{ dataIndex: k0 }]));
Check('nombre corto: un solo renglon', 'Ana Ruiz', T.partir('Ana Ruiz', 18));

// ---------------------------------------------------- clic = mismo filtro
function etiquetaCompleta(id, k) {
  return chartDe(id).config.options.plugins.tooltip.callbacks.title([{ dataIndex: k }]);
}
var F = T.filtroGraf;
clicBarra('chartVenDim', k0);
Check('clic en Director: filtroGraf.ven.dimVal = nombre completo', largo, F.ven.dimVal);
Check('clic en Director: la tabla/graficas usan aplicarFiltroGraf (Agrupador cuenta solo ese director)',
  filas.ven.filter(function (r) { return r.director === largo; }).length, totalDe('chartVenAgrup'));
Check('clic en Director: su barra queda encendida y las demas apagadas', true,
  chartDe('chartVenDim').config.data.datasets[0].backgroundColor.every(function (c, i) {
    return i === k0 ? /^#[0-9a-f]{6}$/i.test(c) : /^#[0-9a-f]{6}40$/i.test(c); }));
Check('clic en Director: Director sigue con todas sus barras (omite su propia seleccion)',
  conteo(filas.ven, 'dim').length, chartDe('chartVenDim').config.data.labels.length);
var agr0 = etiquetaCompleta('chartVenAgrup', 0);
clicBarra('chartVenAgrup', 0);
Check('clic en Agrupador: filtroGraf.ven.agrup', agr0, F.ven.agrup);
Check('Director + Agrupador por AND', filas.ven.filter(function (r) { return r.director === largo && r.agrup === agr0; }).length,
  chartDe('chartVenEstado').config.data.datasets[0].data.reduce(function (s, v) { return s + v; }, 0));
clicBarra('chartVenAgrup', 0);
Check('clic otra vez en el Agrupador: quita ese filtro', '', F.ven.agrup);
Check('quitar Agrupador no toca Director', largo, F.ven.dimVal);

clicBarra('chartActDim', 1);
var dirAct = etiquetaCompleta('chartActDim', 1);
Check('Activas: clic en Director', dirAct, F.act.dimVal);
Check('Activas: Vencidas no se entera', largo, F.ven.dimVal);
var agrAct = etiquetaCompleta('chartActAgrup', 0);
clicBarra('chartActAgrup', 0);
Check('Activas: clic en Agrupador', agrAct, F.act.agrup);

// Estado sigue filtrando igual.
var cEst = chartDe('chartActEstado');
cEst.config.options.onClick({}, [{ index: 0 }]);
Check('Activas: clic en Estado', ests[0], F.act.estado);

// ---------------------------------------------------- reset
botones.btnResetGrafVen.onclick();
Check('Reset Vencidas: sin filtros', '||', [F.ven.dimVal, F.ven.agrup, F.ven.estado].join('|'));
Check('Reset Vencidas: Director vuelve a todas las filas', filas.ven.length, totalDe('chartVenDim'));
Check('Reset Vencidas: Agrupador vuelve a todas las filas', filas.ven.length, totalDe('chartVenAgrup'));
Check('Reset Vencidas: Activas conserva su filtro', dirAct, F.act.dimVal);
botones.btnResetGrafAct.onclick();
Check('Reset Activas: Director vuelve a todas las filas', filas.act.length, totalDe('chartActDim'));
Check('Reset Activas: Agrupador vuelve a todas las filas', filas.act.length, totalDe('chartActAgrup'));
Check('Reset Activas: Estado vuelve a todas las filas', filas.act.length, totalDe('chartActEstado'));
Check('Reset: ninguna barra apagada', false,
  chartDe('chartActDim').config.data.datasets[0].backgroundColor.some(function (c) { return /^#[0-9a-f]{6}40$/i.test(c); }));

// Dimension Product Owner: mismas barras acostadas, colores de persona.
F.act.dim = 'po'; T.renderPanelGraf('act', null);
Check('Ver por Product Owner: titulo', 'Product Owner', elementos.tituloDimAct.textContent);
Check('Ver por Product Owner: barras acostadas', 'y', chartDe('chartActDim').config.options.indexAxis);
F.act.dim = 'director';

// Repintar no deja graficas vivas de mas sobre el mismo canvas.
T.renderPanelGraf('ven', null); T.renderPanelGraf('ven', null);
Check('repintar: una sola grafica viva por canvas', 1,
  vivas.filter(function (c) { return c.vivo && c.canvas === elementos.chartVenDim; }).length);

// Sin datos: mensaje en vez de grafica.
filas.ven = [];
T.renderPanelGraf('ven', null);
Check('sin datos: no queda grafica viva', undefined, chartDe('chartVenDim'));
Check('sin datos: se ve "Sin datos"', false, elementos.chartVenDim.vacio.hidden);
Check('sin datos: el canvas se oculta', 'none', elementos.chartVenDim.style.display);
filas.ven = armar(37, 1);
T.renderPanelGraf('ven', null);
Check('vuelven los datos: grafica viva y canvas visible', 'bar|', chartDe('chartVenDim').config.type + '|' + elementos.chartVenDim.style.display);
Check('vuelven los datos: "Sin datos" oculto', true, elementos.chartVenDim.vacio.hidden);

// ---------------------------------------------------- marcado
['Ven', 'Act'].forEach(function (t) {
  ['Dim', 'Agrup'].forEach(function (g) {
    var id = 'chart' + t + g;
    Check(id + ': es <canvas> dentro de .lienzo-ini-alto', true,
      new RegExp('<div class="lienzo-ini"><div class="lienzo-ini-alto"><canvas id="' + id + '"></canvas></div>').test(html));
    Check(id + ': ya no es caja de treemap', false, new RegExp('id="' + id + '" class="treemap"').test(html));
  });
});
Check('caja de 220px, la misma que tenia el treemap', true,
  /\.lienzo-ini\{[^}]*height:220px/.test(leer('experiencia/experiencia.css')));
// La correccion del primer pintado del treemap (ResizeObserver) sigue en su sitio.
Check('renderTreemap y su ResizeObserver siguen intactos', true,
  /const tmObservador = typeof ResizeObserver==='function'/.test(fuente) && /\nfunction renderTreemap\(/.test(fuente));

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTodo PASS');
process.exit(fallos ? 1 : 0);
