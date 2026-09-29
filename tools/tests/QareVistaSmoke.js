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
// El primer nivel se rotula con el literal de produccion, "Primera vez".
var primera = { Frecuencia: 'Primera vez', FrecuenciaGuia: 'Primera vez', CantidadTickets: 2133, Porcentaje: 44.02 };
Check('Primera vez se rotula Primera vez', 'Primera vez', Q.etiquetaFrecuencia(primera));
Check('Primera vez sin nota (rotulo = valor de la base)', null, Q.notaFrecuencia(primera));
// Si alguna vez rotulo y literal difieren, el tooltip lo dice.
Check('rotulo distinto del literal: el tooltip lo dice', 'En la base: "X"',
  Q.notaFrecuencia({ Frecuencia: 'X', FrecuenciaGuia: 'Y' }));
Check('Ocasional sin nota', null, Q.notaFrecuencia({ Frecuencia: 'Ocasional', FrecuenciaGuia: 'Ocasional' }));
Check('valor fuera de la escala: su propio nombre', 'Otro', Q.etiquetaFrecuencia({ Frecuencia: 'Otro' }));
Check('valor fuera de la escala: sin nota', null, Q.notaFrecuencia({ Frecuencia: 'Otro' }));

// --- Frecuencia: orden fijo de presentacion ---------------------------------
function rotulos(filas) { return filas.map(Q.etiquetaFrecuencia); }
function niv(n, c) { return { Frecuencia: n, FrecuenciaGuia: n, CantidadTickets: c }; }
var FIJO = ['Siempre', 'Frecuente', 'Ocasional', 'Primera vez'];
Check('orden fijo desde el orden del API', FIJO,
  rotulos(Q.ordenFrecuencia([niv('Primera vez', 9), niv('Ocasional', 5), niv('Frecuente', 3), niv('Siempre', 1)])));
Check('orden fijo aunque el API cambie de orden', FIJO,
  rotulos(Q.ordenFrecuencia([niv('Ocasional', 5), niv('Siempre', 1), niv('Primera vez', 9), niv('Frecuente', 3)])));
Check('orden fijo aunque los conteos inviertan el ranking', FIJO,
  rotulos(Q.ordenFrecuencia([niv('Siempre', 900), niv('Primera vez', 1), niv('Frecuente', 50), niv('Ocasional', 70)])));
var hueco = Q.ordenFrecuencia([niv('Primera vez', 9), niv('Siempre', 1)]);
Check('nivel ausente conserva su lugar', FIJO, rotulos(hueco));
Check('nivel ausente va como hueco en cero', [false, true, true, false],
  hueco.map(function (f) { return !!f.sinDato; }));
Check('nivel ausente: conteo 0', [1, 0, 0, 9], hueco.map(function (f) { return f.CantidadTickets; }));
Check('valor fuera de la escala va al final', FIJO.concat(['Otro']),
  rotulos(Q.ordenFrecuencia([{ Frecuencia: 'Otro', CantidadTickets: 2 }, niv('Siempre', 1)])));
var entrada = [niv('Primera vez', 9), niv('Siempre', 1)];
Q.ordenFrecuencia(entrada);
Check('ordenFrecuencia no toca las filas del API', ['Primera vez', 'Siempre'], rotulos(entrada));

// --- query string de qare.ashx: fechas + filtros del Backlog ---------------
Check('sin filtros: solo las fechas (la peticion de siempre)',
  'fecha_inicio=2026-09-01&fecha_fin=2026-09-15', Q.consulta('2026-09-01', '2026-09-15', {}));
Check('sin objeto de filtros: solo las fechas',
  'fecha_inicio=2026-09-01&fecha_fin=2026-09-15', Q.consulta('2026-09-01', '2026-09-15'));
Check('listas vacias no se mandan',
  'fecha_inicio=2026-09-01&fecha_fin=2026-09-15',
  Q.consulta('2026-09-01', '2026-09-15', { c1: [], grupos: [], lideres: [''] }));
Check('los tres filtros, separados por comas y codificados',
  'fecha_inicio=2026-09-01&fecha_fin=2026-09-15&c1=S-Punto%20de%20Venta&grupos=Service%20Desk%2CSoporte%20Campo&lideres=Sin%20Torre',
  Q.consulta('2026-09-01', '2026-09-15',
    { c1: ['S-Punto de Venta'], grupos: ['Service Desk', 'Soporte Campo'], lideres: ['Sin Torre'] }));
Check('solo lideres', 'fecha_inicio=a&fecha_fin=b&lideres=Jesus%20Campa%2CLaura%20Cardenas',
  Q.consulta('a', 'b', { lideres: ['Jesus Campa', 'Laura Cardenas'] }));
Check('mismos nombres de parametro que BacklogUtil.Filtros', ['c1', 'grupos', 'lideres'], Q.FILTROS_ORG);
Check('BacklogUtil.Filtros lee c1/grupos/lideres', true,
  ['"c1"', '"grupos"', '"lideres"'].every(function (k) { return leer('App_Code/DashboardDb.cs').indexOf('ListaONulo(request, ' + k + ')') >= 0; }));
Check('qare.ashx usa BacklogUtil.Filtros', true,
  /QareQueries\.Consultar\(inicio, fin, BacklogUtil\.Filtros\(context\.Request\)\)/.test(leer('handlers/qare.ashx')));

// --- tabla de recurrentes por categoria -------------------------------------
var tabla = Q.filasRecurrentes([
  { Posicion: 1, Categoria: '/S-Biométrico/Falla en sistema de biométrico/Usuario no encontrado', CantidadTickets: 121, TotalTicketsRecurrentes: 1520, PorcentajeRecurrentes: 7.96 },
  { Posicion: 2, Categoria: '/S-Biométrico/Falla en sistema de biométrico/Tarjeta invalida', CantidadTickets: 79, TotalTicketsRecurrentes: 1520, PorcentajeRecurrentes: 5.2 },
  { Posicion: 3, Categoria: null, CantidadTickets: null, PorcentajeRecurrentes: null },
]);
Check('tabla: orden del API, categoria completa, tickets y %', {
  categoria: '/S-Biométrico/Falla en sistema de biométrico/Usuario no encontrado', tickets: '121', pct: '8.0 %' }, tabla[0]);
Check('tabla: segunda fila', '79 | 5.2 %', tabla[1].tickets + ' | ' + tabla[1].pct);
Check('tabla: nulos no rompen', '(sin valor) | n/d | n/d', tabla[2].categoria + ' | ' + tabla[2].tickets + ' | ' + tabla[2].pct);
Check('tabla: vacia', 0, Q.filasRecurrentes([]).length);
Check('tabla: null', 0, Q.filasRecurrentes(null).length);

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
['frecuencia', 'causa', 'tipo'].forEach(function (k) { ids['msg-' + k] = true; });
var faltan = Object.keys(ids).filter(function (id) { return pagina.indexOf('id="qare-' + id + '"') < 0; });
Check('cada id que pide qare.js existe en qare.html', [], faltan);
// Los tres selects de los filtros se piden por un mapa, no por $('...').
['f-c1', 'f-grupos', 'f-lideres', 'btn-limpiar'].forEach(function (id) {
  Check('existe #qare-' + id, true, pagina.indexOf('id="qare-' + id + '"') >= 0);
});
Check('pide las dos fechas al handler', true, /pedir\(consulta\(fi, ff, /.test(codigo));
Check('las listas son las del Backlog', true, /ruta\('backlog_catalogos\.ashx'\)/.test(codigo));
Check('rotulos iguales a los del Backlog', true,
  ['Servicio / C1 (elige varios)', 'Grupos (elige varios)', 'Lideres (elige varios)'].every(function (r) {
    return leer('backlog/backlog.html').indexOf(r) >= 0 && pagina.indexOf(r) >= 0;
  }));

// --- descarga "⬇ Descargar QARE" -----------------------------------------
Check('boton de descarga junto a Limpiar, en .acciones de los filtros', true,
  /<div class="campo acciones">\s*<button class="btn gris" id="qare-btn-limpiar"[^>]*>Limpiar<\/button>[\s\S]*?<button class="btn" id="qare-btn-descargar" type="button" style="display:none">⬇ Descargar QARE<\/button>\s*<\/div>/
    .test(pagina));
Check('ya no esta en la cabecera', false,
  /<div class="acciones-top">[\s\S]*?qare-btn-descargar[\s\S]*?<\/header>/.test(pagina.split('<section class="filtros"')[0]));
Check('nace oculto, como Descargar Tickets de Experiencia', true,
  /id="qare-btn-descargar"[^>]*style="display:none"/.test(pagina));
Check('se muestra solo con algun filtro org', true,
  /style\.display = hayFiltroOrg\(\) \? '' : 'none'/.test(codigo) &&
  /return FILTROS_ORG\.some\(function \(clave\) \{ return seleccionados\(SELECT_FILTRO\[clave\]\)\.length > 0; \}\)/.test(codigo));
Check('se recalcula en el change de los tres selects (Limpiar los dispara)', true,
  /FILTROS_ORG\.forEach\(function \(clave\) \{[\s\S]*?addEventListener\('change', actualizarDescarga\)/.test(codigo) &&
  /sel\.dispatchEvent\(new Event\('change'/.test(codigo));
Check('descarga: MISMA consulta() que el tablero, al handler de export', true,
  /pedir\(consulta\(fi, ff, filtros\), API_EXPORTAR\)/.test(codigo));
Check('descarga: filtros leidos igual que el tablero', true,
  /function descargar\(\)[\s\S]*?var filtros = filtrosElegidos\(\);/.test(codigo));
Check('handler de export', true, /ruta\('qare_exportar\.ashx'\)/.test(codigo));
Check('SheetJS perezoso: ningun <script> del vendor en la pagina', false, /xlsx\.mini/.test(pagina));
Check('SheetJS perezoso: solo cargarXLSX lo inyecta, desde descargar', true,
  /s\.src = XLSX_URL;/.test(codigo) && /return cargarXLSX\(\)\.then/.test(codigo) &&
  (codigo.match(/cargarXLSX\(\)\.then/g) || []).length === 1);
Check('SheetJS: el vendor de Experiencia existe', true,
  fs.existsSync(path.join(raiz, 'experiencia', 'vendor', 'xlsx.mini.min.js')));

// Llaves del libro = llaves del handler, en el mismo orden.
var cs = leer('App_Code/QareExportar.cs');
var llavesCs = (cs.match(/public static readonly string\[\] Columnas =\s*\{([\s\S]*?)\};/) || [, ''])[1]
  .match(/"([A-Za-z_0-9]+)"/g).map(function (s) { return s.slice(1, -1); });
Check('COLUMNAS_EXPORT = QareExportar.Columnas (mismo orden)', llavesCs,
  Q.COLUMNAS_EXPORT.map(function (c) { return c[0]; }));

// Nombre y cabecera: sin filtros = "Todos"; con alguno, "_filtrado".
Check('nombre sin filtros', 'QARE_2026-09-01_a_2026-09-15.xlsx',
  Q.nombreExport('2026-09-01', '2026-09-15', { c1: [], grupos: [''], lideres: [] }));
Check('nombre con filtro', 'QARE_2026-09-01_a_2026-09-15_filtrado.xlsx',
  Q.nombreExport('2026-09-01', '2026-09-15', { lideres: ['Jesus Campa'] }));
Check('cabecera: filtros tal cual, vacio = Todos',
  [['Periodo (FechaFirmaSolucion)', '2026-09-01 a 2026-09-15'], ['Servicio / C1', 'Todos'],
   ['Grupos', 'Service Desk, Soporte Campo'], ['Lideres', 'Todos'], ['Total de tickets', '1,234'],
   ['Exportado', 'x']],
  Q.metaExport('2026-09-01', '2026-09-15', { grupos: ['Service Desk', 'Soporte Campo'] }, 1234, 'x'));

// Columnas: las del SP + C1/Lider/QARe_VerificoClasificacion de la TVF.
function llaves() { return Q.COLUMNAS_EXPORT.map(function (c) { return c[0]; }); }
function col(llave) { return llaves().indexOf(llave); }
Check('51 columnas', 51, Q.COLUMNAS_EXPORT.length);
Check('sin FechaInicio/FechaFin por fila (van en la cabecera)', [-1, -1], [col('FechaInicio'), col('FechaFin')]);
Check('C1 y Lider junto a Grupo', ['Grupo', 'C1', 'Lider'], llaves().slice(col('Grupo'), col('Grupo') + 3));
Check('respuesta cruda QARe_VerificoClasificacion presente', 'QARe_VerificoClasificacion',
  (Q.COLUMNAS_EXPORT[col('QARe_VerificoClasificacion')] || [])[1]);
Check('QARe_UsuarioConfirmo presente, con su nombre', 'QARe_UsuarioConfirmo',
  (Q.COLUMNAS_EXPORT[col('QARe_UsuarioConfirmo')] || [])[1]);
Check('bandera UsuarioConfirmo: llave igual, encabezado aclarado', 'UsuarioConfirmo (VerificoClasificacion = Sí)',
  (Q.COLUMNAS_EXPORT[col('UsuarioConfirmo')] || [])[1]);
Check('el resto de encabezados = nombre de la columna', [],
  Q.COLUMNAS_EXPORT.filter(function (c) { return c[0] !== 'UsuarioConfirmo' && c[0] !== c[1]; }));
Check('llaves sin repetir', Q.COLUMNAS_EXPORT.length,
  llaves().filter(function (k, i, a) { return a.indexOf(k) === i; }).length);

// El libro, armado con el vendor REAL y leido de vuelta.
var XLSX = require(path.join(raiz, 'experiencia', 'vendor', 'xlsx.mini.min.js'));
var largo = new Array(40001).join('a');
var BANDERAS = ['EsRecurrente', 'UsuarioConfirmo', 'EsCasoReutilizable', 'EsPotencialKB',
  'EsInconsistenciaConfirmacionQA', 'EsOportunidadKB'];
var t1 = { CodigoTicket: '000123', FechaFirmaSolucion: '2026-09-02 10:00:00', Lider: 'Sin Torre', C1: 'Sin categoria',
  QA_Frecuencia: 'Siempre', Descripcion: largo, QARe_Evidencia: largo, Titulo: null,
  QARe_VerificoClasificacion: 'Sí', QARe_UsuarioConfirmo: 'No', IntentosSolucion: 2, Caducada: 0,
  EsRecurrente: 1, UsuarioConfirmo: 1, EsCasoReutilizable: 0, EsPotencialKB: 1,
  EsInconsistenciaConfirmacionQA: 0, EsOportunidadKB: 0 };
var bytes = Q.libroExport(XLSX, [t1, { CodigoTicket: 'REQ-2', Validacion: 'Incorrecto' }],
  Q.metaExport('2026-09-01', '2026-09-15', {}, 2, 'x'));
var hoja = XLSX.read(bytes, { type: 'array' }).Sheets['Tickets QARE'];
var filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: true });
var enc = filas.findIndex(function (f) { return f[0] === 'CodigoTicket'; });
Check('libro: encabezados = COLUMNAS_EXPORT', Q.COLUMNAS_EXPORT.map(function (c) { return c[1]; }), filas[enc]);
Check('libro: una fila por ticket', 2, filas.length - enc - 1);
Check('libro: codigo con ceros queda texto', '000123', filas[enc + 1][0]);
Check('libro: Lider y C1 tal cual del servidor', 'Sin Torre|Sin categoria',
  filas[enc + 1][col('Lider')] + '|' + filas[enc + 1][col('C1')]);
Check('libro: cruda y QARe_UsuarioConfirmo tal cual', 'Sí|No',
  filas[enc + 1][col('QARe_VerificoClasificacion')] + '|' + filas[enc + 1][col('QARe_UsuarioConfirmo')]);
Check('libro: banderas 0/1 quedan numero, tal cual', [1, 1, 0, 1, 0, 0],
  BANDERAS.map(function (k) { return filas[enc + 1][col(k)]; }));
Check('libro: celdas de bandera son numericas (tipo n)', BANDERAS.map(function () { return 'n'; }),
  BANDERAS.map(function (k) {
    var ref = XLSX.utils.encode_cell({ r: enc + 1, c: col(k) });
    return hoja[ref] && hoja[ref].t;
  }));
Check('libro: enteros del SP quedan numero', [2, 0],
  [filas[enc + 1][col('IntentosSolucion')], filas[enc + 1][col('Caducada')]]);
Check('libro: fecha queda texto', 's',
  hoja[XLSX.utils.encode_cell({ r: enc + 1, c: col('FechaFirmaSolucion') })].t);
Check('libro: null sale vacio', '', filas[enc + 1][col('Titulo')]);
Check('libro: celda larga recortada al tope de Excel', [Q.LIMITE_CELDA, Q.LIMITE_CELDA],
  [filas[enc + 1][col('Descripcion')].length, filas[enc + 1][col('QARe_Evidencia')].length]);
Check('libro: el recorte avisa cuanto habia', true,
  /\[recortado: 40000 caracteres en origen\]$/.test(filas[enc + 1][col('Descripcion')]));
Check('tope: 32767', 32767, Q.LIMITE_CELDA);
Check('libro: autofiltro = encabezado + filas (51 columnas, A..AY)',
  'A' + (enc + 1) + ':AY' + (enc + 3), hoja['!autofilter'] && hoja['!autofilter'].ref);

// --- formato del libro: el de "Descargar Tickets" de Experiencia ----------
// Se lee el .xlsx YA ESCRITO (el zip), no la hoja en memoria: lo que se
// comprueba es que el retoque de styles.xml y sheet1.xml llego al archivo.
var zip = XLSX.CFB.read(bytes, { type: 'array' });
function parte(ruta) {
  var f = XLSX.CFB.find(zip, ruta);
  return f ? Buffer.from(f.content).toString('utf8') : '';
}
var estilos = parte('/xl/styles.xml');
var hojaXml = parte('/xl/worksheets/sheet1.xml');
var S = Q.LIBRO.ESTILOS;
function s(ref) {
  var m = hojaXml.match(new RegExp('<c r="' + ref + '"[^>]*?(?: s="(\\d+)")[^>]*>'));
  return m ? Number(m[1]) : null;
}
function ref(fila0, llave) { return XLSX.utils.encode_cell({ r: fila0, c: col(llave) }); }
var xfs = (estilos.match(/<cellXfs count="(\d+)">([\s\S]*?)<\/cellXfs>/) || [, '0', ''])[2].match(/<xf [^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
var fonts = (estilos.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/) || [, ''])[1].match(/<font>[\s\S]*?<\/font>/g) || [];
var fills = (estilos.match(/<fills[^>]*>([\s\S]*?)<\/fills>/) || [, ''])[1].match(/<fill>[\s\S]*?<\/fill>/g) || [];
function xfDe(i) {
  var x = xfs[i] || '';
  var num = function (a) { var m = x.match(new RegExp(a + '="(\\d+)"')); return m ? Number(m[1]) : -1; };
  return { font: fonts[num('fontId')] || '', fill: fills[num('fillId')] || '', borde: num('borderId'), x: x };
}

Check('estilos: styles.xml sustituido (14 cellXfs, como LibroTickets)', 14, xfs.length);
var enc0 = xfDe(S.ENCABEZADO);
Check('encabezado: relleno verde del tablero FF166534', true, /fgColor rgb="FF166534"/.test(enc0.fill));
Check('encabezado: texto blanco y negrita', true, /<b\/>/.test(enc0.font) && /FFFFFFFF/.test(enc0.font));
Check('encabezado: borde, centrado vertical y ajuste', true,
  enc0.borde === 1 && /vertical="center"/.test(enc0.x) && /wrapText="1"/.test(enc0.x));
Check('encabezado: las 51 celdas con el estilo de encabezado', true,
  Q.COLUMNAS_EXPORT.every(function (c, i) { return s(XLSX.utils.encode_cell({ r: enc, c: i })) === S.ENCABEZADO; }));
Check('titulo: 16 pt negrita', true, /<b\/><sz val="16"\/>/.test(xfDe(S.TITULO).font) && s('A1') === S.TITULO);
Check('titulo combinado sobre las 51 columnas', true, /<mergeCell ref="A1:AY1"\/>/.test(hojaXml));
// Metadatos: filas 3..8 (1-based); "Total de tickets" es la 5a.
Check('metadatos: etiquetas y valores con estilos distintos', [S.META_ETIQUETA, S.META_VALOR],
  [s('A3'), s('B3')]);
Check('metadatos: Total de tickets resaltado (verde, negrita)', true,
  s('B7') === S.META_FUERTE && /<b\/>/.test(xfDe(S.META_FUERTE).font) && /FF166534/.test(xfDe(S.META_FUERTE).font));
Check('metadatos: Total en su fila', 'Total de tickets', filas[6][0]);
// Panel congelado justo bajo el encabezado: titulo y metadatos a la vista.
Check('panel congelado bajo el encabezado', true,
  new RegExp('<pane ySplit="' + (enc + 1) + '" topLeftCell="A' + (enc + 2) + '" activePane="bottomLeft" state="frozen"/>').test(hojaXml));
Check('autofiltro en el archivo = tabla de 51 columnas', true,
  new RegExp('<autoFilter ref="A' + (enc + 1) + ':AY' + (enc + 3) + '"/>').test(hojaXml));
// Cuerpo: borde fino, fila alterna y columnas largas con ajuste.
Check('cuerpo: borde fino claro', true, xfDe(S.CELDA).borde === 1 && /FFE2E6E4/.test(estilos));
Check('cuerpo: primera fila normal, segunda zebra', [S.CELDA, S.CELDA_ZEBRA],
  [s(ref(enc + 1, 'Grupo')), s(ref(enc + 2, 'Grupo'))]);
Check('zebra: el gris con gota de verde de Experiencia', true, /fgColor rgb="FFF3F6F4"/.test(xfDe(S.CELDA_ZEBRA).fill));
Check('largas: por llave, las ocho columnas de parrafo', Q.LARGAS_EXPORT.length,
  Q.LARGAS_EXPORT.filter(function (k) { return col(k) >= 0; }).length);
Check('largas: con ajuste de texto (y zebra en la alterna)', true,
  Q.LARGAS_EXPORT.every(function (k) {
    return s(ref(enc + 1, k)) === S.CELDA_LARGA && s(ref(enc + 2, k)) === S.CELDA_LARGA_ZEBRA;
  }) && /wrapText="1"/.test(xfDe(S.CELDA_LARGA).x));
Check('corta: sin ajuste', true, !/wrapText/.test(xfDe(S.CELDA).x));
Check('numeros: celdas numericas conservan el tipo y llevan estilo', true,
  BANDERAS.every(function (k) {
    var m = hojaXml.match(new RegExp('<c r="' + ref(enc + 1, k) + '"([^>]*)>'));
    return m && !/ t="/.test(m[1]) && / s="\d+"/.test(m[1]);
  }));
// Anchos: nunca mas estrechos que COLUMNAS_EXPORT; ensanchados solo para que
// quepa la palabra mas larga del encabezado (y la etiqueta en la columna A).
var anchos = Q.anchosExport(Q.metaExport('2026-09-01', '2026-09-15', {}, 2, 'x'));
Check('anchos: ninguno por debajo del declarado', true,
  Q.COLUMNAS_EXPORT.every(function (c, i) { return anchos[i] >= c[2]; }));
Check('anchos: cabe cada palabra del encabezado', true,
  Q.COLUMNAS_EXPORT.every(function (c, i) {
    return c[1].split(' ').every(function (p) { return p.length + 3 <= anchos[i]; });
  }));
Check('anchos: solo se ensancha lo necesario', true,
  Q.COLUMNAS_EXPORT.every(function (c, i) {
    return anchos[i] === c[2] || anchos[i] === Math.max(
      c[1].split(' ').reduce(function (m, p) { return Math.max(m, p.length); }, 0) + 3,
      i === 0 ? 'Periodo (FechaFirmaSolucion)'.length + 2 : 0);
  }));
Check('anchos: columnas largas sin cambio (se ajustan, no se ensanchan)', true,
  Q.LARGAS_EXPORT.every(function (k) { return anchos[col(k)] === Q.COLUMNAS_EXPORT[col(k)][2]; }));
// SheetJS escribe wch + 0.83 (relleno de celda): se compara la parte entera.
Check('anchos: los del archivo', anchos,
  (hojaXml.match(/<col min="\d+" max="\d+" width="[\d.]+"/g) || []).map(function (c) {
    return Math.floor(Number(c.match(/width="([\d.]+)"/)[1]));
  }));

// Semaforo del Estado: mismas reglas que LibroTickets; lo demas sin color.
var estados = ['Cerrado', 'Resuelto', 'Solucionado', 'Cancelado', 'Rechazado', 'Reabierto', 'Escalado',
  'Pendiente', 'En espera', 'En proceso', 'Asignado', 'Abierto', 'Nuevo', 'Otro', ''];
var bytesE = Q.libroExport(XLSX, estados.map(function (e, i) {
  return { CodigoTicket: 'E-' + i, Estado: e, Subestado: 'Cerrado', Prioridad: 'Alta', Validacion: 'Incorrecto' };
}), Q.metaExport('2026-09-01', '2026-09-15', {}, estados.length, 'x'));
var hojaE = (function () {
  var z = XLSX.CFB.read(bytesE, { type: 'array' });
  return Buffer.from(XLSX.CFB.find(z, '/xl/worksheets/sheet1.xml').content).toString('utf8');
})();
function sE(r, llave) {
  var m = hojaE.match(new RegExp('<c r="' + XLSX.utils.encode_cell({ r: r, c: col(llave) }) + '"[^>]*? s="(\\d+)"'));
  return m ? Number(m[1]) : null;
}
var V = S.ESTADO_VERDE, R = S.ESTADO_ROJO, A = S.ESTADO_AMBAR;
Check('Estado: verde / rojo / ambar / sin color', [V, V, V, R, R, R, R, A, A, A, A, A, A, 'normal', 'normal'],
  estados.map(function (e, i) {
    var v = sE(enc + 1 + i, 'Estado');
    return (v === S.CELDA || v === S.CELDA_ZEBRA) ? 'normal' : v;
  }));
Check('Subestado, Prioridad y Validacion sin semaforo', true,
  estados.every(function (e, i) {
    return ['Subestado', 'Prioridad', 'Validacion'].every(function (k) {
      var v = sE(enc + 1 + i, k); return v === S.CELDA || v === S.CELDA_ZEBRA;
    });
  }));
Check('estiloEstado = el de LibroTickets', true,
  (function () {
    var exp = leer('experiencia/experiencia.js');
    return ['(cerrad|resuelt|solucionad|finalizad|complet)', '(cancelad|rechazad|reabiert|escalad)',
      '(pendiente|espera|proceso|curso|asignad|abiert|nuev)'].every(function (r) {
      return exp.indexOf(r) >= 0 && codigo.indexOf(r) >= 0;
    });
  })());
Check('mismos colores que LibroTickets', true,
  ['FF166534', 'FFE7F3EC', 'FF92400E', 'FFFDF3E3', 'FF991B1B', 'FFFCE9E9', 'FF111827', 'FF6B7280',
   'FFF3F6F4', 'FFE2E6E4'].every(function (c) { return leer('experiencia/experiencia.js').indexOf("'" + c + "'") >= 0 && estilos.indexOf(c) >= 0; }));

console.log(fallos === 0 ? 'TODO OK' : fallos + ' FALLOS');
process.exit(fallos === 0 ? 0 : 1);
