// tools/tests/AnalisisModoAutonomoMapaSmoke.js - prueba de humo del mapa por estado
// de Modo Autonomo (analisis/modo_autonomo.js + analisis/mapa_mexico.js, 2026-11-23):
//   - el dibujo: los 32 estados, claves unicas e iguales a las de ESTADOS, cada
//     uno con su path, y el recuadro del centro;
//   - el modelo: cada tienda en el estado de su primer servidor; lo que no se
//     ubica (clave vacia o desconocida, tienda fuera del portal, varias
//     sucursales, servidores en dos estados) no se reparte en otro estado y la
//     hoja lo dice por motivo;
//   - las cuatro capas (eventos, una causa, servidor sin reporte sin reinicios,
//     2 o mas eventos), la tasa y sus clases;
//   - la hoja: el SVG con su recuadro, el tip, los selectores, el estado
//     escogido con sus tiendas, y que sin dibujo (o con uno roto), sin servidor
//     o sin EstadoClave la hoja lo diga y no truene;
//   - la hoja "Por estado" del Excel.
// NO forma parte del sitio. Datos inventados: no toca ninguna base.
//
//   node tools\tests\AnalisisModoAutonomoMapaSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
'use strict';
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var MA = require(path.join(raiz, 'analisis', 'modo_autonomo.js'));
var Motor = require(path.join(raiz, 'analisis', 'motor.js'));
var MAPA = require(path.join(raiz, 'analisis', 'mapa_mexico.js'));
var ExcelJS = require(path.join(raiz, 'analisis', 'vendor', 'exceljs.min.js'));

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}
function Ok(caso, cond, detalle) { if (cond) console.log('PASS  ' + caso); else { fallos++; console.log('FAIL  ' + caso + (detalle ? '  (' + detalle + ')' : '')); } }
function cuenta(s, re) { return (s.match(re) || []).length; }

/* ------------------------------------------------------------------ el dibujo */
var claves = MAPA.estados.map(function (g) { return g.clave; });
Check('el dibujo: 32 estados', 32, MAPA.estados.length);
Check('el dibujo: claves unicas', 32, Object.keys(claves.reduce(function (o, k) { o[k] = 1; return o; }, {})).length);
Check('el dibujo: las mismas claves que ESTADOS', Object.keys(MA.ESTADOS).sort(), claves.slice().sort());
Ok('el dibujo: cada estado con path, nombre y centro', MAPA.estados.every(function (g) {
  return /^M[\d. LZM-]+Z$/.test(g.d) && g.nombre && Array.isArray(g.centro) && g.centro.length === 2;
}));
Ok('el dibujo: tamano y recuadro del centro con sus estados', MAPA.ancho > 0 && MAPA.alto > 0 && MAPA.recuadro.origen.length === 4 &&
   MAPA.recuadro.destino.length === 4 && MAPA.recuadro.escala > 1 &&
   MAPA.recuadro.claves.every(function (k) { return claves.indexOf(k) >= 0; }));

/* ------------------------------------------------------------------ datos */
var EV_COLS = ['Mes', 'Inicio', 'Horas', 'Tienda', 'TiendaNombre', 'Aplicacion', 'Tipo', 'Origen', 'OrigenDetalle', 'RespaldoFallo',
               'Alcance', 'Nivel2', 'Nivel3', 'CausaIM', 'TicketsMA'];
function ev(mes, tienda, origen, horas) {
  return [mes, mes + '-10 10:00', String(horas), tienda == null ? null : String(tienda), tienda == null ? 'Varias sucursales' : 'Sucursal ' + tienda,
          'Modo Autónomo', 'Puntual', origen, '', '0', 'completo', 'n2', 'n3', 'causa', '0'];
}
var EVENTOS = [
  ev('2026-03', 101, 'electrica', 2), ev('2026-04', 101, 'electrica', 1),   // 101 (NLE) repite
  ev('2026-04', 102, 'comunicaciones', 1),                                   // 102 (NLE)
  ev('2026-05', 104, 'electrica', 0.5),                                      // 104 (COA)
  ev('2026-05', 105, 'electrica', 3),                                        // 105 (JAL)
  ev('2026-05', 107, 'sincausa', 1),                                         // 107: clave que no existe
  ev('2026-05', null, 'ups', 0.25)                                           // varias sucursales
];
var FA_COLS = ['Mes', 'Inicio', 'Minutos', 'Tienda', 'TiendaNombre', 'Estado', 'Tipo', 'Causa', 'Horario', 'Cuenta', 'Reporte', 'CausaMA'];
function fa(inicio, tienda, tipo, cuenta, reporte) {
  return [inicio.slice(0, 7), inicio, '30', String(tienda), 'Sucursal ' + tienda, 'x', tipo, 'c', cuenta ? '1' : '0', cuenta ? '1' : '0', reporte, null];
}
var FALLAS = [
  fa('2026-04-10 11:00', 103, 'apagado', true, 'sin'),
  fa('2026-04-11 11:00', 103, 'corte', true, 'sin'),
  fa('2026-04-12 10:00', 101, 'reinicio', true, 'sin'),   // programado: no se pinta
  fa('2026-05-06 12:00', 104, 'corte', true, 'sin'),
  fa('2026-05-07 12:00', 106, 'apagado', true, 'evento'), // con reporte: no se pinta
  fa('2026-05-08 02:00', 106, 'apagado', false, null)     // fuera de horario: no cuenta
];
function srv(t, clave) { return ['SRV' + t, String(t), 'Sucursal ' + t, 'x', '2026-01-01', '2026-01-01', '1', clave]; }
function respuesta(opc) {
  opc = opc || {};
  var cols = ['Servidor', 'Tienda', 'TiendaNombre', 'Estado', 'LogDesde', 'RedDesde', 'Alcanzado'];
  var filas = [srv(101, 'NLE'), srv(101, 'JAL'), srv(102, 'NLE'), srv(103, 'NLE'), srv(108, 'NLE'), srv(104, 'COA'), srv(105, 'JAL'), srv(106, 'JAL'), srv(107, 'XXX')];
  if (opc.sinClave) filas = filas.map(function (f) { return f.slice(0, 7); }); else cols = cols.concat(['EstadoClave']);
  var par = [['UltimaLecturaPortal', '2026-06-01 08:00'], ['Servidores', String(filas.length)]];
  if (opc.sinClaveTxt) par.push(['EstadosSinClave', opc.sinClaveTxt]);
  return {
    servicio: 'modo_autonomo', desde: '2026-03-01', hasta: '2026-05-31',
    bloques: {
      parametros: { columnas: ['Clave', 'Valor'], filas: [['UltimaCargaExcel', '2026-11-20 07:51'], ['CargaTickets', '2026-11-20 07:51']] },
      eventos: { columnas: EV_COLS, filas: EVENTOS },
      incidentes: { columnas: ['Mes', 'Fecha', 'Tienda', 'Tickets', 'Motivo', 'Fuente', 'Nivel2', 'Nivel3', 'SinContacto', 'Alcance', 'TiendaConEventoIM'], filas: [] }
    },
    servidor: opc.noDisponible ? { disponible: false, motivo: 'falta correr 98 (prueba)' } : { disponible: true, bloques: {
      parametros: { columnas: ['Clave', 'Valor'], filas: par },
      fallas: { columnas: FA_COLS, filas: FALLAS },
      modoautonomo: { columnas: ['Fuente', 'Mes', 'Fecha', 'Tienda', 'Causa', 'Nivel2', 'Paso', 'PasoCausa', 'PasoInicio'], filas: [] },
      servidores: { columnas: cols, filas: filas },
      causas: { columnas: ['Tipo', 'Causa', 'Total', 'EnHorario', 'Servidores', 'SinReporte'], filas: [] }
    } }
  };
}
function armar(opc) { return MA.modelo(respuesta(opc), Motor.ocultarClaves); }
var m = armar();

/* ------------------------------------------------------------------ el modelo */
Check('cada tienda en el estado de su primer servidor; XXX se ignora',
      { 101: 'NLE', 102: 'NLE', 103: 'NLE', 104: 'COA', 105: 'JAL', 106: 'JAL', 108: 'NLE' }, m.servidor.estadoTienda);
Check('tiendas por estado (una tienda con dos servidores cuenta una vez)', { NLE: 4, COA: 1, JAL: 2 }, m.servidor.tiendasEstado);

/* ------------------------------------------------------------------ las capas */
function fila(mod, k) { var e = mod.estados[k]; return [e.tiendas, e.afectadas, Math.round(e.tasa * 1000) / 1000, e.eventos, e.horas, e.fallas, e.clase]; }
var ev1 = MA.mapaEstados(m, 'eventos');
Check('eventos: NLE 2 de 4 tiendas, 3 eventos, 4 h', [4, 2, 0.5, 3, 4, 0, 3], fila(ev1, 'NLE'));
Check('eventos: COA 1 de 1, JAL 1 de 2', [[1, 1, 1, 1, 0.5, 0, 5], [2, 1, 0.5, 1, 3, 0, 3]], [fila(ev1, 'COA'), fila(ev1, 'JAL')]);
Check('eventos: sin ubicacion la tienda 107 y la de varias sucursales', 2, ev1.sinUbicacion);
Check('eventos: solo los estados con tiendas', ['COA', 'JAL', 'NLE'], Object.keys(ev1.estados).sort());
Check('eventos: cinco cortes iguales hasta el tope (100%)', [0.2, 0.4, 0.6, 0.8, 1], ev1.cortes);
var cs = MA.mapaEstados(m, 'causa', 'comunicaciones');
Check('causa comunicaciones: solo NLE (102)', [[4, 1, 0.25, 1, 1, 0, 5], [1, 0, 0, 0, 0, 0, 0], [2, 0, 0, 0, 0, 0, 0]],
      [fila(cs, 'NLE'), fila(cs, 'COA'), fila(cs, 'JAL')]);
Check('causa comunicaciones: tope redondo 25%', [0.05, 0.1, 0.15, 0.2, 0.25], cs.cortes.map(function (v) { return Math.round(v * 100) / 100; }));
var sv = MA.mapaEstados(m, 'servidor');
Check('servidor: sin reporte, sin reinicios ni los reportados ni fuera de horario', [[4, 1, 0.25, 0, 0, 2, 2], [1, 1, 1, 0, 0, 1, 5], [2, 0, 0, 0, 0, 0, 0]],
      [fila(sv, 'NLE'), fila(sv, 'COA'), fila(sv, 'JAL')]);
var rp = MA.mapaEstados(m, 'repiten');
Check('repiten: solo 101 (NLE) con 2 o mas', [[4, 1, 0.25, 3, 4, 0, 5], [1, 0, 0, 1, 0.5, 0, 0]], [fila(rp, 'NLE'), fila(rp, 'COA')]);
Check('sin servidor no hay mapa', null, MA.mapaEstados(armar({ noDisponible: true }), 'eventos'));

/* ------------------------------------------------------------------ la hoja */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function ayudas(mapa) {
  return { esc: esc, ancho: function () { return 800; }, mapa: mapa,
           horizontales: function () { return '<svg></svg>'; }, columnas: function () { return '<svg></svg>'; } };
}
Check('la hoja esta entre el servidor y por mes', ['Causas', 'NoLlegan', 'Servidor', 'Mapa', 'Mes', 'Tiendas', 'Detalle'],
      MA.HOJAS.map(function (h) { return h[0]; }));
var h = MA.panel(m, 'Mapa', { Mapa: {} }, ayudas(MAPA));
Ok('hoja: un SVG con 64 paths (los 32 y su copia en el recuadro)', cuenta(h, /<svg class="an-mapa-svg"/g) === 1 && cuenta(h, /<path class="an-edo/g) === 64);
Ok('hoja: el recuadro del centro, recortado y ampliado', /clipPath id="an-mapa-recorte"/.test(h) && /scale\(2\.5\)/.test(h) && /Centro del país, ampliado/.test(h));
Ok('hoja: solo los estados con tiendas abren (en el dibujo, dos veces, y en la tabla)',
   cuenta(h, /<path[^>]*data-ma-estado="NLE"/g) === 2 && cuenta(h, /<button[^>]*data-ma-estado="NLE"/g) === 1 &&
   cuenta(h, /<path[^>]*data-ma-estado="YUC"/g) === 0 && cuenta(h, /class="an-edo sin"/g) === 58);
Ok('hoja: el tip del estado con sus cifras', h.indexOf('data-tip="Nuevo León\n2 de 4 tiendas (50%) con eventos de los IMs\n3 eventos · 4 horas"') >= 0);
Ok('hoja: el tip de un estado sin tiendas', h.indexOf('data-tip="Yucatán\nSin tiendas en el Portal de Indicadores"') >= 0);
Ok('hoja: los colores por clase (COA 100% en la mas oscura)', /<path class="an-edo c5" d="[^"]*" data-ma-estado="COA"/.test(h));
Ok('hoja: el selector de capa con las cuatro, sin el de causa', cuenta(h, /<select data-ma-mapa="capa">/g) === 1 &&
   cuenta(h, /<option value="(eventos|causa|servidor|repiten)"/g) === 4 && h.indexOf('data-ma-mapa="causa"') < 0 && /value="eventos" selected/.test(h));
Ok('hoja: la tabla por estado, de la tasa mayor a la menor; empate, mas tiendas afectadas', h.indexOf('>Coahuila</button>') < h.indexOf('>Nuevo León</button>') &&
   h.indexOf('>Nuevo León</button>') < h.indexOf('>Jalisco</button>'));
// Lo que no se ubica no se reparte en otro estado: la nota dice cuánto y por qué (2026-11-24).
Ok('hoja: lo que no se pinta, separado por motivo', h.indexOf('No se pintan eventos: 1 de tiendas del portal sin estado reconocido; 1 de varias sucursales.') >= 0, h.slice(-700));
Ok('hoja: las tiendas del portal sin estado y la clave desconocida', h.indexOf('Tiendas del portal sin estado reconocido: 1.') >= 0 && h.indexOf('Claves de estado que no se reconocen: XXX.') >= 0);
Ok('hoja: la tienda con servidores en dos estados se avisa', h.indexOf('1 tiendas tienen servidores en estados distintos (101); se pintan en el del primer servidor.') >= 0);
Ok('hoja: sin estado escogido no hay tiendas', h.indexOf('Tiendas de ') < 0);

var hc = MA.panel(m, 'Mapa', { Mapa: { capa: 'causa' } }, ayudas(MAPA));
Ok('causa: sale su selector, con la mas comun escogida', /<select data-ma-mapa="causa">/.test(hc) && /<option value="electrica" selected>Falla eléctrica/.test(hc) &&
   /Tiendas con eventos por falla eléctrica: % de las tiendas/.test(hc));
var hc2 = MA.panel(m, 'Mapa', { Mapa: { capa: 'causa', causa: 'comunicaciones' } }, ayudas(MAPA));
Ok('causa: otra causa cambia lo pintado', /<option value="comunicaciones" selected>/.test(hc2) && /1 de 4 tiendas \(25%\) con eventos por/.test(hc2));
Ok('causa: una causa que no hay en el periodo regresa a la primera',
   /<option value="electrica" selected>/.test(MA.panel(m, 'Mapa', { Mapa: { capa: 'causa', causa: 'clima' } }, ayudas(MAPA))));
var hs = MA.panel(m, 'Mapa', { Mapa: { capa: 'servidor' } }, ayudas(MAPA));
Ok('servidor: su tip y su columna de fallas', /1 de 4 tiendas \(25%\) con apagados o cortes sin reporte\n2 fallas sin reporte/.test(hs) &&
   /Fallas sin reporte<\/th>/.test(hs) && /sin los reinicios programados/.test(hs));
Ok('repiten: su tip', /1 de 4 tiendas \(25%\) con 2 o más eventos/.test(MA.panel(m, 'Mapa', { Mapa: { capa: 'repiten' } }, ayudas(MAPA))));
Ok('una capa desconocida va con la de eventos', /value="eventos" selected/.test(MA.panel(m, 'Mapa', { Mapa: { capa: '<x>' } }, ayudas(MAPA))));

var he = MA.panel(m, 'Mapa', { Mapa: { estado: 'NLE' } }, ayudas(MAPA));
Ok('estado escogido: marcado en el dibujo y en la tabla', cuenta(he, /class="an-edo c\d sel"/g) === 2 && /data-ma-estado="NLE" aria-pressed="true"/.test(he));
var tt = he.slice(he.indexOf('Tiendas de Nuevo León'));
Ok('estado escogido: sus tiendas con algo, la de mas eventos primero',
   tt.indexOf('<td>101</td>') >= 0 && tt.indexOf('<td>101</td>') < tt.indexOf('<td>102</td>') && tt.indexOf('<td>102</td>') < tt.indexOf('<td>103</td>'),
   tt.slice(0, 400));
Ok('estado escogido: las tiendas sin nada solo se cuentan', tt.indexOf('<td>108</td>') < 0 && /Las otras 1 tiendas del estado no tuvieron nada/.test(tt));
Ok('estado escogido: la fila de 101 (eventos, horas, causa, fallas sin reporte)',
   /<td>101<\/td><td>Sucursal 101<\/td><td class="n">2<\/td><td class="n">3<\/td><td>Falla eléctrica \(2\)<\/td><td class="n">0<\/td>/.test(tt));
Ok('estado escogido: 103 con sus 2 fallas sin reporte', /<td>103<\/td><td>Sucursal 103<\/td><td class="n">0<\/td><td class="n">0<\/td><td><\/td><td class="n">2<\/td>/.test(tt));
Ok('un estado sin tiendas no se escoge', MA.panel(m, 'Mapa', { Mapa: { estado: 'YUC' } }, ayudas(MAPA)).indexOf('Tiendas de ') < 0);

/* ------------------------------------------------------------------ lo que puede faltar */
var sinDibujo = MA.panel(m, 'Mapa', { Mapa: {} }, ayudas(null));
Ok('sin el dibujo: lo dice y deja la tabla', sinDibujo.indexOf('<svg') < 0 && /No se pudo cargar el dibujo del mapa/.test(sinDibujo) && /data-ma-estado="NLE"/.test(sinDibujo));
var roto = (function () { try { return MA.panel(m, 'Mapa', { Mapa: {} }, ayudas({ estados: [] })); } catch (e) { return 'TRONO: ' + e.message; } })();
Ok('con un dibujo roto: igual que sin dibujo', /No se pudo cargar el dibujo del mapa/.test(roto), roto.slice(0, 120));
Ok('sin el servidor: la hoja dice por que', /No disponible: falta correr 98 \(prueba\)\./.test(MA.panel(armar({ noDisponible: true }), 'Mapa', {}, ayudas(MAPA))));
var sinClave = armar({ sinClave: true });
Ok('un 98 sin EstadoClave: la hoja dice que falta', /ninguna tienda trae su estado/.test(MA.panel(sinClave, 'Mapa', {}, ayudas(MAPA))));
Check('modelo: tiendas sin estado, en conflicto y claves desconocidas', [[107], [101], ['XXX'], true], [m.servidor.tiendasSinEstado, m.servidor.tiendasEnConflicto, m.servidor.clavesInvalidas, m.servidor.columnaEstado]);
Check('eventos: lo no ubicado, por motivo', { varias: 1, fueraPortal: 0, sinEstado: 1 }, ev1.sinUbicacionPor);
Ok('un 98 sin EstadoClave: no se confunde con datos vacios', /Falta la versión del 98_caidas_servidor.sql/.test(MA.panel(sinClave, 'Mapa', {}, ayudas(MAPA))));
Ok('un 98 sin EstadoClave: las demas hojas siguen', /Qué se compara/.test(MA.panel(sinClave, 'Servidor', {}, ayudas(MAPA))));
(function () {
  var r = respuesta(); r.servidor.bloques.servidores.filas.forEach(function (f) { f[7] = null; });
  var h0 = MA.panel(MA.modelo(r, Motor.ocultarClaves), 'Mapa', {}, ayudas(MAPA));
  Ok('EstadoClave en la columna pero todo nulo: lo dice, no culpa al 98 viejo', h0.indexOf('ningún servidor tiene una clave reconocida (todas vacías).') >= 0 && h0.indexOf('Falta la versión') < 0, h0);
  r = respuesta(); r.servidor.bloques.servidores.filas = [];
  Ok('sin ningun servidor: lo dice', /no trajo ningún servidor/.test(MA.panel(MA.modelo(r, Motor.ocultarClaves), 'Mapa', {}, ayudas(MAPA))));
  r = respuesta(); r.bloques.eventos.filas.push(ev('2026-05', 999, 'electrica', 1));
  var m9 = MA.modelo(r, Motor.ocultarClaves), e9 = MA.mapaEstados(m9, 'eventos');
  Check('una tienda que no esta en el portal no se pinta ni se suma', [1, 3], [e9.sinUbicacionPor.fueraPortal, e9.estados.NLE.eventos]);
  r = respuesta(); r.bloques.eventos.filas = [];
  var vacio = (function () { try { return MA.panel(MA.modelo(r, Motor.ocultarClaves), 'Mapa', { Mapa: { capa: 'causa' } }, ayudas(MAPA)); } catch (e) { return 'TRONO: ' + e.message; } })();
  Ok('periodo sin eventos: el mapa en 0% sin tronar, y sin opciones de causa', /<path class="an-edo c0"/.test(vacio) && vacio.indexOf('<select data-ma-mapa="causa"></select>') >= 0, vacio.slice(0, 200));
})();
var aviso = MA.panel(armar({ sinClaveTxt: '<b>Edo. Mex</b>' }), 'Mapa', {}, ayudas(MAPA));
Ok('los estados que el portal no reconoce se avisan, escapados', aviso.indexOf('&lt;b&gt;Edo. Mex&lt;/b&gt;') >= 0 && aviso.indexOf('<b>Edo. Mex') < 0);

/* ------------------------------------------------------------------ el Excel */
function libro(modelo) {
  return MA.armarLibro(modelo, ExcelJS).xlsx.writeBuffer().then(function (buf) { var wb = new ExcelJS.Workbook(); return wb.xlsx.load(buf).then(function () { return wb; }); });
}
libro(m).then(function (wb) {
  var ws = wb.getWorksheet('Por estado');
  Ok('Excel: trae la hoja "Por estado", la ultima', !!ws && wb.worksheets[wb.worksheets.length - 1].name === 'Por estado');
  function filaX(i) { var r = ws.getRow(i), o = []; for (var c = 1; c <= 12; c++) o.push(r.getCell(c).value); return o; }
  Check('Excel: sus columnas', ['Estado', 'Tiendas', 'Con eventos del IM', '% con eventos', 'Eventos', 'Horas', 'Con 2 o más eventos', '% con 2 o más',
                               'Con fallas del servidor sin reporte', '% con fallas sin reporte', 'Fallas sin reporte', 'Causa principal'], filaX(1));
  Check('Excel: un renglon por estado con tiendas, por nombre', 4, ws.rowCount);
  Check('Excel: Coahuila', ['Coahuila', 1, 1, 100, 1, 0.5, 0, 0, 1, 100, 1, 'Falla eléctrica (1)'], filaX(2));
  Check('Excel: Nuevo León', ['Nuevo León', 4, 2, 50, 3, 4, 1, 25, 1, 25, 2, 'Falla eléctrica (2)'], filaX(4));
}).then(function () {
  return libro(armar({ noDisponible: true }));
}).then(function (wb) {
  Ok('Excel sin el servidor: sin la hoja "Por estado"', !wb.getWorksheet('Por estado'));
}).catch(function (e) { fallos++; console.log('FAIL  el Excel: ' + e.message); }).then(function () {
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
});
