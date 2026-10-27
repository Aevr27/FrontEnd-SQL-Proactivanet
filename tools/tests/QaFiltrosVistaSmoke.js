// tools/tests/QaFiltrosVistaSmoke.js - la parte pura de qa/qa.js: rango por
// omision, parametros de cada vista y el libro de "⬇ Descargar QA".
//
// NO forma parte del sitio. Carga el qa/qa.js REAL con un `window` de
// mentira y SIN document (como QareVistaSmoke.js con qare.js): window.QaDatos
// se publica y el tablero se corta solo. Comprueba ademas que cada id que
// qa.js pide exista en qa/qa.html y que el libro se lea de vuelta con el
// mismo vendor de SheetJS.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\QaFiltrosVistaSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8'); }

var ventana = {};
(new Function('window', leer('qa/qa.js')))(ventana);
var Q = ventana.QaDatos;

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

Check('QaDatos publicado', 'object', typeof Q);
Check('sin document no hay modulo de tablero', 'undefined', typeof ventana.TableroQaModulo);

// --- rango: los dias que terminan AYER en Mexico (UTC-6 fijo) ----------------
var t = Date.UTC(2026, 9, 27, 5, 59);   // 26/10 23:59 en Mexico
Check('15 dias a las 23:59 de Mexico: terminan el 25', { inicio: '2026-10-11', fin: '2026-10-25' }, Q.rangoRapido(15, t));
Check('15 dias un minuto despues: terminan el 26', { inicio: '2026-10-12', fin: '2026-10-26' }, Q.rangoRapido(15, t + 60e3));
Check('30 dias', { inicio: '2026-09-27', fin: '2026-10-26' }, Q.rangoRapido(30, t + 60e3));
Check('por omision son 15', 15, Q.DIAS_POR_OMISION);

// --- parametros de cada vista --------------------------------------------------
var D = { inicio: '2026-10-12', fin: '2026-10-26' };
function vista(i, f, filtros) { return { inicio: i, fin: f, filtros: filtros || {} }; }
Check('vista por omision: ningun parametro (la peticion de siempre)', {}, Q.parametrosVista(vista(D.inicio, D.fin), D));
Check('por omision con listas vacias o con huecos sigue siendo por omision', {},
  Q.parametrosVista(vista(D.inicio, D.fin, { c1: [], grupos: [''], lideres: [null] }), D));
Check('otra fecha: rango explicito, sin filtros', { fecha_inicio: '2026-10-20', fecha_fin: D.fin },
  Q.parametrosVista(vista('2026-10-20', D.fin), D));
Check('un filtro org con el rango por omision: rango explicito y el filtro',
  { fecha_inicio: D.inicio, fecha_fin: D.fin, lideres: 'Sin Torre' },
  Q.parametrosVista(vista(D.inicio, D.fin, { lideres: ['Sin Torre'] }), D));
Check('los tres combinados, listas separadas por comas (como qare.js)',
  { fecha_inicio: D.inicio, fecha_fin: D.fin, c1: 'S-A,S-B', grupos: 'G1', lideres: 'L1,L2' },
  Q.parametrosVista(vista(D.inicio, D.fin, { c1: ['S-A', 'S-B'], grupos: ['G1'], lideres: ['L1', 'L2'] }), D));
Check('sin defecto (la descarga): siempre explicito', { fecha_inicio: D.inicio, fecha_fin: D.fin },
  Q.parametrosVista(vista(D.inicio, D.fin), null));
Check('hayFiltroOrg', [false, true], [Q.hayFiltroOrg({ c1: [''] }), Q.hayFiltroOrg({ grupos: ['G'] })]);

// --- descarga -----------------------------------------------------------------
var COLS = Q.COLUMNAS_EXPORT.map(function (c) { return c[0]; });
Check('50 columnas: las 48 de usp_CorreoQA_Detalle + C1 y Lider', 50, COLS.length);
Check('C1 y Lider junto a Grupo, como en el libro de QARE', ['Grupo', 'C1', 'Lider'], COLS.slice(3, 6));
Check('sin columnas repetidas', COLS.length, COLS.filter(function (c, i) { return COLS.indexOf(c) === i; }).length);
// Las 49 del procedimiento, en su orden, leidas del script versionado.
var sp = leer('sql/fix_qa_detalle_option_recompile.sql');
var cuerpo = sp.slice(sp.indexOf('SELECT TOP (@TopSeguro)'), sp.indexOf('FROM dbo.vw_CorreoQA_Base'));
var delSp = [];
cuerpo.split(/\r?\n/).forEach(function (l) {
  var m = /^\s*(?:\[([^\]]+)\]\s*=|([A-Za-z]+),?\s*$)/.exec(l);
  if (m) delSp.push(m[1] || m[2]);
});
Check('las columnas del SP en su orden (sin C1 / Lider)', delSp,
  COLS.filter(function (c) { return c !== 'C1' && c !== 'Lider'; }));
Check('encabezado = llave: no se renombra nada', true, Q.COLUMNAS_EXPORT.every(function (c) { return c[0] === c[1]; }));
Check('valorExport: fecha sin T, bit 1/0, numero, null vacio, texto tal cual',
  ['2026-10-20 08:15:00', 1, 0, 7, '', '2026-10-20', 'x'],
  [Q.valorExport('2026-10-20T08:15:00'), Q.valorExport(true), Q.valorExport(false), Q.valorExport(7),
    Q.valorExport(null), Q.valorExport('2026-10-20'), Q.valorExport('x')]);
var largo = new Array(Q.LIMITE_CELDA + 10).join('a');
Check('celda larga recortada al tope de Excel', Q.LIMITE_CELDA, Q.valorExport(largo).length);
Check('nombre del archivo', ['QA_2026-10-01_a_2026-10-15_filtrado.xlsx', 'QA_2026-10-01_a_2026-10-15.xlsx'],
  [Q.nombreExport('2026-10-01', '2026-10-15', { c1: ['S'] }), Q.nombreExport('2026-10-01', '2026-10-15', {})]);
var meta = Q.metaExport('2026-10-01', '2026-10-15', { c1: ['S-A', 'S-B'], grupos: [], lideres: ['L1'] }, 1234, 'ahora');
Check('cabecera del libro', [['Periodo (Fecha de registro)', '2026-10-01 a 2026-10-15'], ['Servicio / C1', 'S-A, S-B'],
  ['Grupos', 'Todos'], ['Lideres', 'L1'], ['Total de tickets', '1,234'], ['Exportado', 'ahora']], meta);

var XLSX = require(path.join(raiz, 'experiencia', 'vendor', 'xlsx.mini.min.js'));
var tickets = [
  { 'Código': 'INC-1', 'Fecha de registro': '2026-10-02T10:00:00', Grupo: 'G1', C1: 'S-A', Lider: 'L1', Estado: 'Cerrado',
    Validacion: 'Incorrecto', Caducada: true, 'Intentos de solución': 3, IdProactivanet: 'no-va' },
  { 'Código': 'INC-2', Grupo: 'G2', C1: 'S-B', Lider: null, Estado: 'En espera', Validacion: 'OK' },
];
var bytes = Q.libroExport(XLSX, tickets, meta);
var libro = XLSX.read(bytes, { type: 'array' });
var hoja = libro.Sheets['Tickets QA'];
var filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', raw: true });
var enc = filas.findIndex(function (f) { return f[0] === 'Fecha de registro'; });
function celda(r, k) { return filas[enc + 1 + r][COLS.indexOf(k)]; }
Check('libro: una hoja "Tickets QA" y el titulo', [['Tickets QA'], 'QA — Tickets'], [libro.SheetNames, filas[0][0]]);
Check('libro: encabezado completo y 2 tickets', [COLS, 2], [filas[enc], filas.length - enc - 1]);
Check('libro: valores', ['INC-1', '2026-10-02 10:00:00', 'S-A', 'L1', 1, 3, 'INC-2', '', ''],
  [celda(0, 'Código'), celda(0, 'Fecha de registro'), celda(0, 'C1'), celda(0, 'Lider'), celda(0, 'Caducada'),
    celda(0, 'Intentos de solución'), celda(1, 'Código'), celda(1, 'Lider'), celda(1, 'Caducada')]);
Check('libro: IdProactivanet no va', false, filas[enc].indexOf('IdProactivanet') >= 0);
var xml = Buffer.from(XLSX.CFB.find(XLSX.CFB.read(bytes, { type: 'array' }), '/xl/worksheets/sheet1.xml').content).toString('utf8');
Check('libro: panel congelado bajo el encabezado y autofiltro', [true, true],
  [xml.indexOf('state="frozen"') > 0 && xml.indexOf('topLeftCell="A' + (enc + 2) + '"') > 0, !!hoja['!autofilter']]);
var E = Q.LIBRO.ESTILOS;
function estilo(r, k) {
  var ref = XLSX.utils.encode_cell({ r: enc + 1 + r, c: COLS.indexOf(k) });
  var m = new RegExp('<c r="' + ref + '"[^>]*? s="(\\d+)"').exec(xml);
  return m ? Number(m[1]) : null;
}
Check('libro: semaforo del Estado (Cerrado verde, En espera ambar)', [E.ESTADO_VERDE, E.ESTADO_AMBAR],
  [estilo(0, 'Estado'), estilo(1, 'Estado')]);

// --- cableado: cada id que qa.js pide existe en qa.html ------------------------------
var js = leer('qa/qa.js'), html = leer('qa/qa.html');
var ids = {};
js.replace(/\$\('([a-z0-9-]+)'\)/g, function (_, id) { ids[id] = true; });
js.replace(/SELECT_FILTRO = \{([^}]*)\}/, function (_, cuerpo) {
  cuerpo.replace(/'([a-z0-9-]+)'/g, function (__, id) { ids[id] = true; });
});
var faltan = Object.keys(ids).filter(function (id) { return html.indexOf('id="qa-' + id + '"') < 0; });
Check('cada $(id) de qa.js existe en qa.html', [], faltan);
Check('la pagina suelta carga catalogos.js (Catalogos.llenar)', true, /assets\/js\/catalogos\.js/.test(html));
var dash = leer('dashboard.html');
Check('el tablero ya carga catalogos.js y desplegable.js para el modulo embebido', [true, true],
  [/assets\/js\/catalogos\.js/.test(dash), /assets\/js\/desplegable\.js/.test(dash)]);

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
