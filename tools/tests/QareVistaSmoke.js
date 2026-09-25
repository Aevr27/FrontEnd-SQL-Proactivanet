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
// Literales EXACTOS de produccion (diag v2): sin acentos.
Check('produccion: OK -> verde', 'ok', Q.claseValidacion('OK'));
Check('produccion: Valido -> verde', 'ok', Q.claseValidacion('Valido'));
Check('produccion: Incorrecto -> rojo', 'mal', Q.claseValidacion('Incorrecto'));
Check('produccion: Sin catalogo -> amarillo', 'sin', Q.claseValidacion('Sin catalogo'));
Check('Sin validacion (respaldo del SP) -> neutro', null, Q.claseValidacion('Sin validaci'));

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

// Matriz con la forma real del SP: literales intactos y EsInconsistencia
// presente (el tablero no la interpreta; solo no debe romper nada).
var mr = Q.matriz([
  { ConfirmacionUsuario: 'Sí', ValidacionQA: 'OK', CantidadTickets: 2617, PorcentajeDelTotal: 63.74, EsInconsistencia: 0 },
  { ConfirmacionUsuario: 'Sí', ValidacionQA: 'Valido', CantidadTickets: 389, PorcentajeDelTotal: 9.47, EsInconsistencia: 0 },
  { ConfirmacionUsuario: 'Sí', ValidacionQA: 'Incorrecto', CantidadTickets: 184, PorcentajeDelTotal: 4.48, EsInconsistencia: 1 },
  { ConfirmacionUsuario: 'Sí', ValidacionQA: 'Sin catalogo', CantidadTickets: 193, PorcentajeDelTotal: 4.70, EsInconsistencia: 0 },
  { ConfirmacionUsuario: 'No', ValidacionQA: 'OK', CantidadTickets: 564, PorcentajeDelTotal: 13.74, EsInconsistencia: 0 },
]);
Check('matriz real: filas Sí, No', ['Sí', 'No'], mr.filas);
Check('matriz real: columnas en el orden del SP y sin reescribir', ['OK', 'Valido', 'Incorrecto', 'Sin catalogo'], mr.columnas);
Check('matriz real: Sí/Incorrecto', 184, mr.celdas['Sí'].Incorrecto.cantidad);

// --- etiquetas largas: completas, en varias lineas -------------------------
var partida = Q.partirEtiqueta('Software > Aplicaciones corporativas > Correo electronico', 20);
Check('categoria larga partida en lineas', true, Array.isArray(partida) && partida.length > 1);
Check('categoria larga sin perder texto', 'Software > Aplicaciones corporativas > Correo electronico', partida.join(' '));
Check('categoria corta queda en una linea', 'Red', Q.partirEtiqueta('Red', 20));

// --- rango rapido: dias naturales que terminan HOY en Mexico (UTC-6) --------
// Instantes en UTC, para que la prueba no dependa de la zona de esta maquina.
Check('15 dias al 25/09 (mediodia Mexico)', { inicio: '2026-09-11', fin: '2026-09-25' },
  Q.rangoRapido(15, Date.UTC(2026, 8, 25, 18, 0)));
Check('25/09 23:30 Mexico = 26/09 05:30 UTC: sigue siendo 25/09', { inicio: '2026-09-11', fin: '2026-09-25' },
  Q.rangoRapido(15, Date.UTC(2026, 8, 26, 5, 30)));
Check('26/09 00:00 Mexico = 26/09 06:00 UTC: ya es 26/09', { inicio: '2026-09-12', fin: '2026-09-26' },
  Q.rangoRapido(15, Date.UTC(2026, 8, 26, 6, 0)));
Check('30 dias cruzando mes', { inicio: '2026-02-02', fin: '2026-03-03' }, Q.rangoRapido(30, Date.UTC(2026, 2, 3, 18)));
Check('1 de enero', { inicio: '2025-12-18', fin: '2026-01-01' }, Q.rangoRapido(15, Date.UTC(2026, 0, 1, 18)));
Check('un dia = hoy..hoy', { inicio: '2026-09-25', fin: '2026-09-25' }, Q.rangoRapido(1, Date.UTC(2026, 8, 25, 18)));

// --- pie de KPI: "X de Y" con el denominador del SP -------------------------
Check('pie X de Y', '3,383 de 4,106', Q.pieKpi(3383, 4106));
Check('pie sin denominador', '344 tickets', Q.pieKpi(344, null));
Check('pie sin numerador', 'sin dato de tickets', Q.pieKpi(null, 4106));
Check('pie con cero', '0 de 0', Q.pieKpi(0, 0));

// --- Frecuencia: rotulo de la guia, valor de la base intacto ----------------
var primera = { Frecuencia: 'Primera vez', FrecuenciaGuia: 'Nunca', CantidadTickets: 2133, Porcentaje: 44.02 };
Check('Primera vez se rotula con el nivel de la guia', 'Nunca', Q.etiquetaFrecuencia(primera));
Check('el valor de la base no se toca', 'Primera vez', primera.Frecuencia);
Check('el tooltip dice el literal de la base', 'En la base: "Primera vez"', Q.notaFrecuencia(primera));
Check('Ocasional sin nota', null, Q.notaFrecuencia({ Frecuencia: 'Ocasional', FrecuenciaGuia: 'Ocasional' }));
Check('valor fuera de la escala: su propio nombre', 'Otro', Q.etiquetaFrecuencia({ Frecuencia: 'Otro' }));
Check('valor fuera de la escala: sin nota', null, Q.notaFrecuencia({ Frecuencia: 'Otro' }));

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
