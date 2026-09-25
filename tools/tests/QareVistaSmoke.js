// tools/tests/QareVistaSmoke.js - prueba de humo de la vista QARE.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca.
//
// Carga el qare/qare.js REAL con un `window` de mentira y SIN document: la
// parte pura (window.QareDatos) se publica y la del tablero se corta sola.
// Comprueba ademas el cableado de la pestaña: que dashboard.html tenga su
// boton y su contenedor, que dashboard.js la registre en MODULOS con
// moduloEmbebido, y que cada id que qare.js pide exista en qare/qare.html.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\QareVistaSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8'); }

var ventana = {};
(new Function('window', leer('qare/qare.js')))(ventana);
var Q = ventana.QareDatos;

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

// --- sin document, la parte del tablero no arranca -----------------------
Check('QareDatos publicado', 'object', typeof Q);
Check('sin document no hay modulo de tablero', 'undefined', typeof ventana.TableroQareModulo);

// --- numeros y nulos -------------------------------------------------------
Check('numero(null) sigue null', null, Q.numero(null));
Check('numero("") es null', null, Q.numero(''));
Check('numero("12.5")', 12.5, Q.numero('12.5'));
Check('numero("abc") es null', null, Q.numero('abc'));
Check('entero(null) = n/d', 'n/d', Q.entero(null));
Check('pct(null) = n/d', 'n/d', Q.pct(undefined));
Check('pct(62.5) en escala 0-100, sin multiplicar', '62.5 %', Q.pct(62.5));
Check('etiqueta(null)', '(sin valor)', Q.etiqueta(null));
Check('etiqueta vacia', '(vacio)', Q.etiqueta('  '));

// --- semantica de color de la validacion ----------------------------------
Check('OK -> verde', 'ok', Q.claseValidacion('OK'));
Check('Válido -> verde', 'ok', Q.claseValidacion('Válido'));
Check('valido -> verde', 'ok', Q.claseValidacion(' valido '));
Check('Incorrecto -> rojo', 'mal', Q.claseValidacion('Incorrecto'));
Check('Sin catálogo -> amarillo', 'sin', Q.claseValidacion('Sin catálogo'));
Check('Sin catalogo -> amarillo', 'sin', Q.claseValidacion('SIN  CATALOGO'));
Check('otro estado -> neutro, no se inventa', null, Q.claseValidacion('Pendiente'));
Check('null -> neutro', null, Q.claseValidacion(null));

// --- matriz ----------------------------------------------------------------
var m = Q.matriz([
  { ConfirmacionUsuario: 'Si', ValidacionQA: 'OK', CantidadTickets: 60, PorcentajeDelTotal: 50 },
  { ConfirmacionUsuario: 'Si', ValidacionQA: 'Incorrecto', CantidadTickets: 10, PorcentajeDelTotal: 8.3 },
  { ConfirmacionUsuario: 'No', ValidacionQA: 'Sin catálogo', CantidadTickets: 5, PorcentajeDelTotal: 4.2 },
  { ConfirmacionUsuario: null, ValidacionQA: 'OK', CantidadTickets: null, PorcentajeDelTotal: null },
]);
Check('matriz: filas = ConfirmacionUsuario en orden de llegada', ['Si', 'No', '(sin valor)'], m.filas);
Check('matriz: columnas = ValidacionQA en orden de llegada', ['OK', 'Incorrecto', 'Sin catálogo'], m.columnas);
Check('matriz: valor = CantidadTickets', 10, m.celdas.Si.Incorrecto.cantidad);
Check('matriz: tooltip = PorcentajeDelTotal', 8.3, m.celdas.Si.Incorrecto.pct);
Check('matriz: celda nula sigue nula', null, m.celdas['(sin valor)'].OK.cantidad);
Check('matriz: par ausente no se inventa', undefined, m.celdas.No.OK);
Check('matriz: maximo', 60, m.max);
Check('matriz vacia', { filas: [], columnas: [], max: 0 },
  (function (x) { return { filas: x.filas, columnas: x.columnas, max: x.max }; })(Q.matriz([])));
Check('matriz null', 0, Q.matriz(null).filas.length);

// --- etiquetas largas: completas, en varias lineas -------------------------
var partida = Q.partirEtiqueta('Software > Aplicaciones corporativas > Correo electronico', 20);
Check('categoria larga partida en lineas', true, Array.isArray(partida) && partida.length > 1);
Check('categoria larga sin perder texto', 'Software > Aplicaciones corporativas > Correo electronico', partida.join(' '));
Check('categoria corta queda en una linea', 'Red', Q.partirEtiqueta('Red', 20));

// --- rango rapido: dias completos que terminan ayer -------------------------
Check('15 dias al 25/09', { inicio: '2026-09-10', fin: '2026-09-24' }, Q.rangoRapido(15, new Date(2026, 8, 25, 23, 30)));
Check('30 dias cruzando mes', { inicio: '2026-02-01', fin: '2026-03-02' }, Q.rangoRapido(30, new Date(2026, 2, 3)));
Check('1 de enero', { inicio: '2025-12-17', fin: '2025-12-31' }, Q.rangoRapido(15, new Date(2026, 0, 1)));

// --- cableado de la pestaña -------------------------------------------------
var html = leer('dashboard.html');
var js = leer('dashboard.js');
Check('boton de navegacion', true, /id="mtab-qare" data-tab="qare"/.test(html));
Check('contenedor de la pestaña', true, /<div id="tab-qare" class="maintab-content"/.test(html));
Check('registrada en MODULOS', true, /qare: TableroQare,/.test(js));
Check('montaje perezoso con moduloEmbebido', true,
  /const TableroQare = moduloEmbebido\(\{[\s\S]*?base: 'qare\/'[\s\S]*?guion: 'qare\.js'/.test(js));
Check('dashboard.html no pide qare.ashx al cargar', false,
  /qare\.ashx/.test(html.replace(/<!--[\s\S]*?-->/g, '')));

var pagina = leer('qare/qare.html');
var codigo = leer('qare/qare.js');
Check('pagina envuelta en #tab-qare', true, /<div id="tab-qare" class="maintab-content active">/.test(pagina));
var ids = {};
(codigo.match(/\$\('([a-z0-9-]+)'\)/g) || []).forEach(function (s) { ids[s.slice(3, -2)] = true; });
['frecuencia', 'causa', 'recurrentes', 'tipo'].forEach(function (k) { ids['msg-' + k] = true; });
var faltan = Object.keys(ids).filter(function (id) { return pagina.indexOf('id="qare-' + id + '"') < 0; });
Check('cada id que pide qare.js existe en qare.html', [], faltan);
Check('pide las dos fechas al handler', true, /fecha_inicio=[\s\S]*?&fecha_fin=/.test(codigo));

console.log(fallos === 0 ? 'TODO OK' : fallos + ' FALLOS');
process.exit(fallos === 0 ? 0 : 1);
