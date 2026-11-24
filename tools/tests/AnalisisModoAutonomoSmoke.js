// tools/tests/AnalisisModoAutonomoSmoke.js - prueba de humo de la vista de Modo
// Autonomo en "Analisis de servicios" (analisis/modo_autonomo.js, 2026-11-20):
//   - el modelo: eventos e incidentes leidos de la respuesta de
//     analisis.ashx?accion=modo_autonomo, el arbol de 3 niveles (un nivel vacio
//     corta la rama; "Sin detalle" se marca), buscar una ruta, las cifras, los
//     hallazgos, los avisos (sin tickets clasificados, sin niveles), por mes y
//     por tienda;
//   - las hojas: el zoom con sus migas y lo que abre el siguiente nivel, por
//     mes, tiendas y detalle;
//   - el Excel (con el ExcelJS de la pagina): sus siete hojas y sus filas;
//   - (2026-11-23) las tarjetas con el ultimo mes del periodo abajo, y el
//     servidor de la tienda (98): sus cuentas en los dos sentidos, la hoja, el
//     hallazgo, el aviso cuando no esta y sus cinco hojas del Excel (mas la
//     del mapa, que prueba AnalisisModoAutonomoMapaSmoke.js);
//   - que los nombres de los origenes y motivos sean los de reglas.py (si el
//     repositorio lo trae al lado).
//
//   - que CausaIM y OrigenDetalle salgan con las contraseñas tapadas
//     (Motor.ocultarClaves) en pantalla y en el Excel, y que el modelo no se
//     arme sin esa función;
// NO forma parte del sitio. Datos inventados: no toca ninguna base.
//
//   node tools\tests\AnalisisModoAutonomoSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var MA = require(path.join(raiz, 'analisis', 'modo_autonomo.js'));
var Motor = require(path.join(raiz, 'analisis', 'motor.js'));
var ExcelJS = require(path.join(raiz, 'analisis', 'vendor', 'exceljs.min.js'));

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}
function Ok(caso, cond, detalle) { if (cond) console.log('PASS  ' + caso); else { fallos++; console.log('FAIL  ' + caso + (detalle ? '  (' + detalle + ')' : '')); } }

/* ------------------------------------------------------------------ datos */
var SD = 'Sin detalle';
var EV_COLS = ['Mes', 'Inicio', 'Horas', 'Tienda', 'TiendaNombre', 'Aplicacion', 'Tipo', 'Origen', 'OrigenDetalle', 'RespaldoFallo',
               'Alcance', 'Nivel2', 'Nivel3', 'CausaIM', 'TicketsMA'];
var IN_COLS = ['Mes', 'Fecha', 'Tienda', 'Tickets', 'Motivo', 'Fuente', 'Nivel2', 'Nivel3', 'SinContacto', 'Alcance', 'TiendaConEventoIM'];
function ev(mes, tienda, origen, n2, n3, horas, respaldo, tickets) {
  return [mes, mes + '-10 10:00', String(horas), tienda == null ? null : String(tienda), tienda == null ? 'Varias sucursales' : 'Sucursal ' + tienda,
          'Modo Autónomo', 'Puntual', origen, '', respaldo ? '1' : '0', 'completo', n2, n3, 'causa', String(tickets || 0)];
}
function inc(mes, tienda, motivo, fuente, n2, n3, tickets) {
  return [mes, mes + '-05 09:00', tienda == null ? null : String(tienda), String(tickets), motivo, fuente, n2, n3, '0', 'parcial', '0'];
}
var EVENTOS = [
  ev('2026-03', 101, 'electrica', 'El UPS no sostuvo', 'Sin pila o se descargó', 2, true, 3),
  ev('2026-03', 101, 'electrica', 'El UPS no sostuvo', 'Alarmado o se protegió', 1.5, true, 0),
  ev('2026-04', 102, 'electrica', 'El UPS no sostuvo', 'Sin pila o se descargó', 1, true, 1),
  ev('2026-04', 103, 'electrica', 'Planta de emergencia', SD, 4, true, 0),
  ev('2026-04', 104, 'electrica', 'Solo el corte (no dice qué falló)', 'Corte o apagón de CFE', 0.5, false, 0),
  ev('2026-05', 101, 'comunicaciones', 'Red local de la tienda', 'Switch', 1, false, 2),
  ev('2026-05', null, 'ups', 'Alarmado o se protegió', '', 0.25, false, 0),
  ev('2026-05', 105, 'sincausa', 'No se identificó la causa', '', 0.75, false, 0)
];
var INCIDENTES = [
  inc('2026-03', 201, 'probable_electrica', 'supuesto', 'La solución no dice la causa', '', 1),
  inc('2026-03', 202, 'red_caja', 'documentado', 'Cable o nodo', 'Cable', 2),
  inc('2026-04', 202, 'red_caja', 'tienda', 'Cable o nodo', 'Nodo', 1),
  inc('2026-04', 101, 'operador', 'documentado', 'Baja forzada del operador', '', 3),
  inc('2026-05', null, 'probable_electrica', 'supuesto', 'Cerrado sin contactar a la tienda', '', 1)
];
// El servidor de la tienda (dbo.usp_Analisis_ModoAutonomoServidor), inventado.
var FA_COLS = ['Mes', 'Inicio', 'Minutos', 'Tienda', 'TiendaNombre', 'Estado', 'Tipo', 'Causa', 'Horario', 'Cuenta', 'Reporte', 'CausaMA'];
function fa(inicio, min, tienda, estado, tipo, causa, cuenta, reporte, causaMA) {
  return [inicio.slice(0, 7), inicio, String(min), String(tienda), 'Sucursal ' + tienda, estado, tipo, causa, cuenta ? '1' : '0', cuenta ? '1' : '0',
          cuenta ? reporte : null, causaMA || null];
}
var FALLAS = [
  fa('2026-03-10 09:00', 120, 101, 'Nuevo León', 'apagado', 'Falla eléctrica', true, 'evento', 'electrica'),
  fa('2026-04-10 11:00', 60, 103, 'Nuevo León', 'apagado', 'Falla eléctrica', true, 'sin'),
  fa('2026-04-12 10:00', 15, 101, 'Nuevo León', 'reinicio', 'Parcheo (ccmexec.exe)', true, 'sin'),
  fa('2026-05-03 15:00', 30, 106, 'Jalisco', 'apagado', 'Sin causa en el log', true, 'sin'),
  fa('2026-05-04 23:30', 45, 106, 'Jalisco', 'apagado', 'Sin causa en el log', false),
  fa('2026-05-06 12:00', 18, 104, 'Coahuila', 'corte', 'Corte de red', true, 'ticket', 'red_caja'),
  fa('2026-05-07 13:00', 25, 104, 'Coahuila', 'corte', 'Corte de red', true, 'sin')
];
var MS_COLS = ['Fuente', 'Mes', 'Fecha', 'Tienda', 'Causa', 'Nivel2', 'Paso', 'PasoCausa', 'PasoInicio'];
function ms(fuente, fecha, tienda, causa, n2, paso, pasoInicio) {
  return [fuente, fecha.slice(0, 7), fecha, String(tienda), causa, n2, paso, pasoInicio ? 'Corte de red' : null, pasoInicio || null];
}
var MA_SRV = [
  ms('ticket', '2026-03-05 09:00', 201, 'probable_electrica', 'La solución no dice la causa', 'nada'),
  ms('ticket', '2026-03-05 09:00', 202, 'red_caja', 'Cable o nodo', 'corte', '2026-03-05 08:30'),
  ms('im', '2026-03-10 10:00', 101, 'electrica', 'El UPS no sostuvo', 'apagado', '2026-03-10 09:00'),
  ms('im', '2026-03-10 10:00', 101, 'electrica', 'El UPS no sostuvo', 'nada'),
  ms('ticket', '2026-04-05 09:00', 202, 'red_caja', 'Cable o nodo', 'nada'),
  ms('im', '2026-04-10 10:00', 102, 'electrica', 'El UPS no sostuvo', 'sinlog'),
  ms('im', '2026-05-10 10:00', 101, 'comunicaciones', 'Red local de la tienda', 'corte', '2026-05-10 09:50')
];
function servidor() {
  return {
    disponible: true,
    bloques: {
      parametros: { columnas: ['Clave', 'Valor'], filas: [['Desde', '2026-03-01'], ['Hasta', '2026-05-31'], ['UltimaLecturaPortal', '2026-06-01 08:00'],
        ['UltimaCargaPortal', '2026-06-01 08:05'], ['Servidores', '5'], ['NoAlcanzados', '1'], ['HorarioDesde', '7'], ['HorarioHasta', '23'],
        ['CorteMinimoMin', '5'], ['ReinicioMin', '15'], ['MargenEventoMin', '120'], ['TicketAntesMin', '120'], ['TicketDespuesMin', '240']] },
      fallas: { columnas: FA_COLS, filas: FALLAS },
      modoautonomo: { columnas: MS_COLS, filas: MA_SRV },
      servidores: { columnas: ['Servidor', 'Tienda', 'TiendaNombre', 'Estado', 'LogDesde', 'RedDesde', 'Alcanzado'], filas: [101, 102, 103, 104, 106].map(function (t) {
        return ['SRVPRB' + t, String(t), 'Sucursal ' + t, 'Nuevo León', '2026-01-01', '2026-02-01', t === 102 ? '0' : '1']; }) },
      causas: { columnas: ['Tipo', 'Causa', 'Total', 'EnHorario', 'Servidores', 'SinReporte'], filas: [
        ['apagado', 'Falla eléctrica', '2', '2', '2', '1'], ['apagado', 'Sin causa en el log', '2', '1', '1', '1'],
        ['reinicio', 'Parcheo (ccmexec.exe)', '1', '1', '1', '1'], ['corte', 'Corte de red', '2', '2', '1', '1']] }
    }
  };
}
// srv: sin darlo, el servidor de arriba; null, la respuesta de un sitio sin el cambio del 2026-11-23.
function respuesta(conTickets, srv) {
  var r = {
    servicio: 'modo_autonomo', desde: '2026-03-01', hasta: '2026-05-31',
    bloques: {
      parametros: { columnas: ['Clave', 'Valor'], filas: [['Desde', '2026-03-01'], ['Hasta', '2026-05-31'],
        ['UltimaCargaExcel', '2026-11-20 07:51'], ['CargaTickets', conTickets ? '2026-11-20 07:51' : null],
        ['TicketsMADesde', '2026-01-01'], ['ReglasVersion', '2026-11-20'], ['Eventos', '8'], ['Incidentes', '5'], ['TicketsSueltos', '8']] },
      eventos: { columnas: EV_COLS, filas: EVENTOS },
      incidentes: { columnas: IN_COLS, filas: conTickets ? INCIDENTES : [] }
    }
  };
  if (srv !== null) r.servidor = srv || servidor();
  return r;
}

/* ------------------------------------------------------------------ el modelo */
// La página le pasa Motor.ocultarClaves (analisis.js); aquí, igual.
function armarModelo(r) { return MA.modelo(r, Motor.ocultarClaves); }
var m = armarModelo(respuesta(true));
Check('lee 8 eventos y 5 incidentes', [8, 5], [m.eventos.length, m.incidentes.length]);
Check('horas, tiendas y las que repiten', [11, 5, 1], [m.cifras.horas, m.cifras.tiendas, m.cifras.tiendasRepiten]);
Check('respaldo: 4 de 5 electricas', [4, 5], [m.cifras.respaldo, m.cifras.electricas]);
Check('incidentes: 8 tickets, 2 supuestos', [8, 2], [m.cifras.ticketsSueltos, m.cifras.supuestos]);
Check('eventos sin detalle (nivel 2 o 3)', 1, m.cifras.eventosSinDetalle);

var a = m.arbolEventos;
Check('nivel 1 ordenado de mayor a menor, con su nombre', [['electrica', 'Falla eléctrica', 5], ['comunicaciones', 'Comunicaciones', 1]],
      a.hijos.slice(0, 2).map(function (x) { return [x.clave, x.nombre, x.n]; }));
var e = a.hijos[0];
Check('nivel 2 de electrica', [['El UPS no sostuvo', 3], ['Planta de emergencia', 1], ['Solo el corte (no dice qué falló)', 1]],
      e.hijos.map(function (x) { return [x.nombre, x.n]; }));
Check('nivel 3 del UPS, con horas y tiendas', [['Sin pila o se descargó', 2, 3, 2], ['Alarmado o se protegió', 1, 1.5, 1]],
      e.hijos[0].hijos.map(function (x) { return [x.nombre, x.n, x.horas, x.tiendas]; }));
Ok('"Sin detalle" marcado', e.hijos[1].hijos[0].sinDetalle && !e.hijos[0].hijos[0].sinDetalle);
var ups = a.hijos.filter(function (x) { return x.clave === 'ups'; })[0];
Check('un nivel 3 vacio corta la rama (UPS sin corte)', [1, 0], [ups.hijos.length, ups.hijos[0].hijos.length]);
Check('buscar una ruta', 'Sin pila o se descargó', MA.buscar(a, ['electrica', 'El UPS no sostuvo', 'Sin pila o se descargó']).nodo.nombre);
Check('una clave que ya no esta corta la ruta ahi', ['Falla eléctrica', 2], (function (b) { return [b.nodo.nombre, b.camino.length]; })(MA.buscar(a, ['electrica', 'No existe', 'x'])));
Check('incidentes: nivel 1 por motivo', [['probable_electrica', 2], ['red_caja', 2], ['operador', 1]],
      m.arbolIncidentes.hijos.map(function (x) { return [x.clave, x.n]; }));
Check('incidentes: red de la caja abre cable y nodo, con sus tickets',
      [['Cable o nodo', 2, 3, [['Cable', 2], ['Nodo', 1]]]],
      m.arbolIncidentes.hijos[1].hijos.map(function (x) { return [x.nombre, x.n, x.tickets, x.hijos.map(function (y) { return [y.nombre, y.tickets]; })]; }));

Check('hallazgo 1: la rama mayor, sin pasar por Sin detalle',
      'La causa principal de los eventos de los IMs es falla eléctrica: 5 de 8 (63%); dentro, el UPS no sostuvo (3) y, en eso, sin pila o se descargó (2).',
      m.hallazgos[0]);
Check('hallazgo 2: el servidor de la tienda, con el mes', 'El servidor de la tienda falló 6 veces en horario de tienda (3 en mayo): 67% sin reporte de Modo Autónomo.', m.hallazgos[1]);
Ok('hallazgos: respaldo, no llegan, sin detalle y tiendas', m.hallazgos.length === 6 &&
   /4 de 5 fallas eléctricas/.test(m.hallazgos[2]) && /No llegaron al IM 5 incidentes \(8 tickets\)/.test(m.hallazgos[3]) &&
   /40% no tiene causa documentada \(cuentan como probable falla eléctrica\); de los demás, el motivo principal es red de la caja \(cable, nodo, IP\), con 2\./.test(m.hallazgos[3]) && /^1 eventos \(13%\)/.test(m.hallazgos[4]) && /la 101 con 3/.test(m.hallazgos[5]), m.hallazgos.join(' | '));
Check('sin avisos con todo cargado', [], m.avisos);
Check('por mes', [['2026-03', 2, 2, 3], ['2026-04', 3, 2, 4], ['2026-05', 3, 1, 1]],
      m.meses.map(function (x) { return [x.mes, x.eventos, x.incidentes, x.tickets]; }));
Check('por tienda: la 101 primero, con su causa principal y lo que no llega al IM', [101, 3, 'Falla eléctrica (2)', 1, 3],
      [m.tiendas[0].tienda, m.tiendas[0].eventos, m.tiendas[0].principal, m.tiendas[0].incidentes, m.tiendas[0].tickets]);
Ok('por tienda: sin las de varias sucursales', m.tiendas.every(function (x) { return x.tienda != null; }));
Check('KPIs: el periodo y, abajo, su ultimo mes', [
        ['Eventos de los IMs', '8', '11 horas en Modo Autónomo', 'Mayo: 3 (2 h)', ''],
        ['Tiendas', '5', '1 con 2 o más eventos', 'Mayo: 2', ''],
        ['Causa principal', '63%', 'Falla eléctrica', 'Mayo: 0% (0)', ''],
        ['El respaldo no sostuvo', '4', 'de 5 fallas eléctricas', 'Mayo: 0 de 0', ''],
        ['No llegan al IM', '5', '8 tickets en incidentes', 'Mayo: 1', ''],
        ['Servidor sin reporte', '4', 'de 6 fallas en horario (67%)', 'Mayo: 2 de 3', 'sr'],
        ['Sin detalle', '13%', 'de los eventos no dice el detalle', 'Mayo: 0%', '']], MA.kpis(m));
function conPeriodo(desde, hasta) { var r = respuesta(true); r.desde = desde; r.hasta = hasta; return armarModelo(r).corte.etiqueta; }
Check('el pie: el mes completo, lo que va del mes, o desde el dia en que empieza',
      ['Mayo', 'Del 1 al 20 de mayo', 'Del 5 al 20 de mayo', 'Febrero', 'Del 1 al 28 de febrero'],
      [conPeriodo('2026-03-01', '2026-05-31'), conPeriodo('2026-03-01', '2026-05-20'), conPeriodo('2026-05-05', '2026-05-20'),
       conPeriodo('2024-01-01', '2024-02-29'), conPeriodo('2024-01-01', '2024-02-28')]);
Check('el mes del pie: eventos, horas y tiendas de mayo', [3, 2, 2, 1], [m.cifrasMes.eventos, m.cifrasMes.horas, m.cifrasMes.tiendas, m.cifrasMes.incidentes]);

/* ------------------------------------------------------------------ el servidor */
var s = m.servidor;
Check('servidor: fallas en horario y sin reporte (el apagado fuera de horario no cuenta)', [6, 4, 3, 2, 7], [s.fallas, s.sinReporte, s.fallasMes, s.sinReporteMes, s.todas.length]);
Check('servidor: por tipo', { apagado: { n: 3, mes: 1, horas: 3.5, horasMes: 0.5, evento: 1, ticket: 0, sin: 2, sinMes: 1 },
                              reinicio: { n: 1, mes: 0, horas: 0.3, horasMes: 0, evento: 0, ticket: 0, sin: 1, sinMes: 0 },
                              corte: { n: 2, mes: 2, horas: 0.7, horasMes: 0.7, evento: 0, ticket: 1, sin: 1, sinMes: 1 } }, s.porTipo);
Check('servidor: los eventos del IM por causa (sin log no se juzga)', [['electrica', 3, 2, 1, 1, 1], ['comunicaciones', 1, 1, 0, 0, 1]],
      s.porOrigen.map(function (x) { return [x.causa, x.total, x.juzgados, x.sinLog, x.nada, x.conServidor]; }));
Check('servidor: los tickets por motivo', [['red_caja', 2, 1, 1], ['probable_electrica', 1, 1, 0]],
      s.porMotivo.map(function (x) { return [x.causa, x.total, x.nada, x.conServidor]; }));
Check('servidor: tiendas por apagados y cortes; los reinicios no cuentan como sin reporte', [[104, 0, 2, 1, 1], [103, 1, 0, 1, 1], [106, 1, 0, 1, 0], [101, 1, 0, 0, 3]],
      s.tiendas.map(function (x) { return [x.tienda, x.apagado, x.corte, x.sin, x.eventosIM]; }));
Check('servidor: juzgados', [4, 3, 3, 3], [s.eventosIM, s.eventosIMJuzgados, s.incidentes, s.incidentesJuzgados]);
Check('sin el 98: no disponible, con el motivo, y la tarjeta sin cifra',
      [false, ['Servidor sin reporte', '—', 'sin datos del Portal de Indicadores', '', ''], ['La comparación con el servidor de la tienda no está disponible: falta correr 98 (prueba).']],
      (function (x) { return [x.servidor.disponible, MA.kpis(x)[5], x.avisos]; })(armarModelo(respuesta(true, { disponible: false, motivo: 'falta correr 98 (prueba)' }))));
var sinCambio = armarModelo(respuesta(true, null));
Ok('un sitio sin el cambio del 2026-11-23: lo avisa y no hay hallazgo del servidor', /falta subir al sitio el analisis\.ashx/.test(sinCambio.avisos[0]) &&
   sinCambio.hallazgos.length === 5 && !/servidor de la tienda/.test(sinCambio.hallazgos.join(' ')), sinCambio.avisos.join(' | '));

var m2 = armarModelo(respuesta(false));
Ok('aviso sin tickets clasificados', m2.avisos.length === 1 && /crit\.TicketMA/.test(m2.avisos[0]) && m2.cifras.incidentes === 0, m2.avisos.join(' | '));
var r3 = respuesta(true); r3.bloques.eventos.filas = EVENTOS.map(function (f) { var g = f.slice(); g[11] = null; g[12] = null; return g; });
Ok('aviso sin niveles (Excel cargado antes del 2026-11-20)', armarModelo(r3).avisos.some(function (x) { return /nivel 2 y 3/.test(x); }));
var vacio = respuesta(true); vacio.bloques.eventos.filas = []; vacio.bloques.incidentes.filas = [];
Check('un periodo vacio', ['No hay eventos de los IMs ni incidentes de Modo Autónomo en el periodo.'], armarModelo(vacio).hallazgos);

/* ------------------------------------------------------------------ las hojas */
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
var dibujos = [];
var ayudas = {
  esc: esc, ancho: function () { return 800; },
  // Como la de analisis.js, escapa lo que pinta.
  horizontales: function (d) { dibujos.push(d); return '<svg>' + d.map(function (x) { return '[' + esc(x.e) + '|' + esc(x.zoom || '') + '|' + (x.apagada ? 'gris' : '') + ']'; }).join('') + '</svg>'; },
  columnas: function (d) { return '<svg>' + d.map(function (x) { return x.e + '=' + x.v; }).join(',') + '</svg>'; }
};
var h1 = MA.panel(m, 'Causas', { Causas: [] }, ayudas);
Ok('zoom nivel 1: migas en la raiz y cada origen con su clave para abrir', /<b aria-current="true">Todas las causas<\/b>/.test(h1) &&
   h1.indexOf('[Falla eléctrica|electrica|]') >= 0 && h1.indexOf('[Base de datos') < 0, h1.slice(0, 300));
Ok('zoom nivel 1: la tabla trae botones para abrir', /class="an-zoom" data-ma-hoja="Causas" data-ma-zoom="electrica">Falla eléctrica<\/button>/.test(h1));
var h2 = MA.panel(m, 'Causas', { Causas: ['electrica'] }, ayudas);
Ok('zoom nivel 2: migas para regresar y el titulo del nivel', /data-ma-ruta="\[\]">Todas las causas<\/button>/.test(h2) &&
   /<b aria-current="true">Falla eléctrica<\/b>/.test(h2) && /Falla eléctrica: nivel 2/.test(h2), h2.slice(0, 400));
Ok('zoom nivel 2: el UPS abre, en % de la electrica, y la columna dice "Nivel 2"', h2.indexOf('[El UPS no sostuvo|El UPS no sostuvo|]') >= 0 && /<td>60%<\/td>/.test(h2) &&
   /<th scope="col">Nivel 2<\/th>/.test(h2));
var h3 = MA.panel(m, 'Causas', { Causas: ['electrica', 'Planta de emergencia'] }, ayudas);
Ok('zoom nivel 3: "Sin detalle" en gris y sin abrir mas; la columna dice "Nivel 3"', h3.indexOf('[Sin detalle||gris]') >= 0 && /<th scope="col">Nivel 3<\/th>/.test(h3) &&
   /data-ma-ruta="\[&quot;electrica&quot;\]">Falla eléctrica<\/button>/.test(h3), h3.slice(0, 500));
var h4 = MA.panel(m, 'Causas', { Causas: ['ups', 'Alarmado o se protegió'] }, ayudas);
Ok('un nivel que no se abre mas lo dice', /Este nivel no se abre más/.test(h4));
var hn = MA.panel(m, 'NoLlegan', { NoLlegan: ['red_caja'] }, ayudas);
Ok('lo que no llega al IM: su propio zoom, en tickets', /Todos los motivos/.test(hn) && hn.indexOf('[Cable o nodo|Cable o nodo|]') >= 0 && /<th scope="col" class="n">Tickets<\/th>/.test(hn));
var hm = MA.panel(m, 'Mes', {}, ayudas);
Ok('por mes: las dos graficas y la tabla', /mar 26=2,abr 26=3,may 26=3/.test(hm) && /mar 26=2,abr 26=2,may 26=1/.test(hm) && /Mes a mes/.test(hm));
var ht = MA.panel(m, 'Tiendas', {}, ayudas);
Ok('tiendas: la tabla con la causa principal', /<td>Falla eléctrica \(2\)<\/td>/.test(ht) && /Las primeras 30 de 7/.test(ht), ht.slice(0, 200));
var hd = MA.panel(m, 'Detalle', {}, ayudas);
Ok('detalle: eventos e incidentes, sin folios', /Eventos de los IMs/.test(hd) && /Incidentes que no llegan al IM/.test(hd) && /Supuesto/.test(hd) && !/INC /.test(hd));
var hs = MA.panel(m, 'Servidor', {}, ayudas);
Ok('servidor: explica que se compara, en los dos sentidos', /Qué se compara/.test(hs) && /Fallas del servidor sin reporte<\/b>/.test(hs) &&
   /Modo Autónomo con el servidor bien<\/b>/.test(hs) && /con 2 h de margen a cada lado/.test(hs) && /entre 2 h antes de que empiece la falla y 4 h después/.test(hs) &&
   /de 7:00 a 22:59/.test(hs) && /Logs leídos el 2026-06-01 08:00/.test(hs), hs.slice(0, 400));
Ok('servidor: sus tarjetas con el mes abajo', /Apagados sin aviso<\/div><div class="val">3<\/div>/.test(hs) && /<div class="foot an-mes">Mayo: 2 de 3<\/div>/.test(hs), hs.slice(400, 1600));
Ok('servidor: las barras apiladas, con su leyenda', /class="an-seg evento" style="width:33\.33%"/.test(hs) && /class="an-seg sin" style="width:66\.67%"/.test(hs) &&
   /3 · 67% sin reporte/.test(hs) && /<i class="an-seg ticket" aria-hidden="true"><\/i>Ticket de Modo Autónomo/.test(hs));
Ok('servidor: la frase de la falla electrica', /En los eventos eléctricos del IM el servidor falló en el 50% \(1 de 2\); en los tickets de probable falla eléctrica solo en el 0%/.test(hs));
Ok('servidor: la tabla de lo que le paso al servidor', /<td>Evento del IM<\/td><td>Falla eléctrica<\/td><td class="n">3<\/td><td class="n">2<\/td><td class="n">1<\/td>/.test(hs) &&
   /3 de 4 eventos del IM y 3 de 3 incidentes/.test(hs));
Ok('servidor: las tiendas y las fallas sin reporte, la mas reciente primero', hs.indexOf('<td>104</td>') < hs.indexOf('<td>103</td>') &&
   hs.indexOf('2026-05-07 13:00') < hs.indexOf('2026-05-03 15:00') && hs.indexOf('2026-05-04 23:30') < 0 && /1 servidores no se alcanzaron/.test(hs));
Ok('servidor no disponible: la hoja dice por que', /No disponible: falta correr 98 \(prueba\)\./.test(MA.panel(armarModelo(respuesta(true, { disponible: false, motivo: 'falta correr 98 (prueba)' })), 'Servidor', {}, ayudas)));
Ok('servidor: lo escapa todo', (function () {
  var r = respuesta(true); r.servidor.bloques.fallas.filas = [fa('2026-05-06 12:00', 18, 104, '<i>e</i>', 'apagado', '<b>x</b>', true, 'sin')];
  var h = MA.panel(armarModelo(r), 'Servidor', {}, ayudas); return h.indexOf('<b>x</b>') < 0 && h.indexOf('&lt;b&gt;x') >= 0;
})());
Ok('lo escapa todo', MA.panel(armarModelo((function () { var r = respuesta(true); r.bloques.eventos.filas = [ev('2026-03', 1, 'electrica', '<b>x</b>', 'y', 1, false, 0)]; return r; })()),
                             'Causas', { Causas: ['electrica'] }, ayudas).indexOf('<b>x</b>') < 0);

/* ------------------------------------------------------------------ contraseñas */
Ok('el modelo no se arma sin la función que tapa', (function () { try { MA.modelo(respuesta(true)); return false; } catch (e) { return /ocultarClaves/.test(e.message); } })());
Check('el motor publica ocultarClaves', 'function', typeof Motor.ocultarClaves);
var conClave = (function () {
  var r = respuesta(true);
  r.bloques.eventos.filas = EVENTOS.map(function (f) { return f.slice(); });
  r.bloques.eventos.filas[0][8] = 'clave temporal X9z-7';                        // OrigenDetalle
  r.bloques.eventos.filas[0][13] = 'UPS sin pila; la contraseña: Abc123! del NVR'; // CausaIM
  return armarModelo(r);
})();
Ok('CausaIM tapada', /contraseña: \*\*\*\*/.test(conClave.eventos[0].causaIM) && !/Abc123/.test(conClave.eventos[0].causaIM), conClave.eventos[0].causaIM);
Ok('OrigenDetalle tapado', /clave temporal \*\*\*\*/.test(conClave.eventos[0].detalle) && !/X9z/.test(conClave.eventos[0].detalle), conClave.eventos[0].detalle);
Check('texto sin contraseña queda igual', 'causa', conClave.eventos[1].causaIM);
Ok('Detalle: la contraseña no sale en pantalla', (function (h) { return /\*\*\*\*/.test(h) && !/Abc123|X9z/.test(h); })(MA.panel(conClave, 'Detalle', {}, ayudas)));

/* ------------------------------------------------------------------ nombres de reglas.py */
var reglasPy = path.join(raiz, '..', 'analisis_modo_autonomo', 'reglas.py');
if (fs.existsSync(reglasPy)) {
  var py = fs.readFileSync(reglasPy, 'utf8');
  function lista(nombre) {
    var b = new RegExp(nombre + ' = \\[([\\s\\S]*?)\\n\\]').exec(py)[1], o = {}, re = /\('([a-z_]+)', '([^']+)'\)/g, x;
    while ((x = re.exec(b))) o[x[1]] = x[2];
    return o;
  }
  Check('los origenes son los de reglas.py', lista('ORIGENES'), MA.ORIGENES);
  Check('los motivos son los de reglas.py', lista('MOTIVOS_TICKET'), MA.MOTIVOS);
  Check('"Sin detalle" igual que reglas.py', /SIN_DETALLE = '([^']+)'/.exec(py)[1], MA.SIN_DETALLE);
} else {
  console.log('SKIP  nombres contra reglas.py (no esta al lado del sitio)');
}

/* ------------------------------------------------------------------ el Excel */
function libro(modelo) {
  return MA.armarLibro(modelo, ExcelJS).xlsx.writeBuffer().then(function (buf) { var wb = new ExcelJS.Workbook(); return wb.xlsx.load(buf).then(function () { return wb; }); });
}
libro(sinCambio).then(function (wb) {
  Check('el Excel sin el servidor: las siete hojas de antes', ['Resumen', 'Causas de los IMs', 'No llegan al IM', 'Por mes', 'Tiendas', 'Eventos', 'Incidentes sin IM'],
        wb.worksheets.map(function (w) { return w.name; }));
  Ok('el Excel sin el servidor: el resumen lo dice', wb.getWorksheet('Resumen').getColumn(1).values.some(function (v) { return /Servidor de la tienda: no disponible/.test(String(v)); }));
}).then(function () {
  return libro(m);
}).then(function (wb) {
  return Promise.resolve().then(function () {
    Check('el Excel: las siete hojas, las cinco del servidor y la del mapa', ['Resumen', 'Causas de los IMs', 'No llegan al IM', 'Por mes', 'Tiendas', 'Eventos', 'Incidentes sin IM',
          'Servidor por tipo', 'Servidor y Modo Autónomo', 'Fallas del servidor', 'Modo Autónomo y su servidor', 'Servidores', 'Por estado'],
          wb.worksheets.map(function (w) { return w.name; }));
    var r = wb.getWorksheet('Resumen'), filaEv = r.getColumn(1).values.indexOf('Eventos de los IMs');
    Check('el resumen: cada tarjeta con el periodo y su ultimo mes', ['Eventos de los IMs', '8', '11 horas en Modo Autónomo', '3 (2 h)'],
          [1, 2, 3, 4].map(function (i) { return r.getRow(filaEv).getCell(i).value; }));
    Check('el resumen: el encabezado dice que mes', 'Mayo', r.getRow(filaEv - 1).getCell(4).value);
    Check('fallas del servidor: todas (la de fuera de horario, sin reporte)', [7, ['2026-05-04 23:30', 'No', '']],
          [wb.getWorksheet('Fallas del servidor').rowCount - 1, [1, 8, 9].map(function (i) { return wb.getWorksheet('Fallas del servidor').getRow(6).getCell(i).value; })]);
    Check('Modo Autonomo y su servidor: cada evento y ticket, sin log dicho', [7, 'Sin log (no se juzga)'],
          [wb.getWorksheet('Modo Autónomo y su servidor').rowCount - 1, wb.getWorksheet('Modo Autónomo y su servidor').getRow(7).getCell(6).value]);
    Check('servidores: con si se alcanzo', ['SRVPRB102', 'No'], [wb.getWorksheet('Servidores').getRow(3).getCell(1).value, wb.getWorksheet('Servidores').getRow(3).getCell(7).value]);
    var c = wb.getWorksheet('Causas de los IMs');
    Check('causas: una fila por hoja del arbol (un nivel vacio queda en blanco)', 7, c.rowCount - 1);
    Check('causas: la primera rama', ['Falla eléctrica', 'El UPS no sostuvo', 'Sin pila o se descargó', 2, 3],
          [1, 2, 3, 4, 5].map(function (i) { return c.getRow(2).getCell(i).value; }));
    Check('eventos e incidentes, todos', [8, 5], [wb.getWorksheet('Eventos').rowCount - 1, wb.getWorksheet('Incidentes sin IM').rowCount - 1]);
    Ok('el resumen trae los hallazgos', wb.getWorksheet('Resumen').getColumn(1).values.some(function (v) { return /La causa principal/.test(String(v)); }));
  });
}).then(function () {
  return libro(conClave);
}).then(function (wb) {
  var todo = []; wb.eachSheet(function (ws) { ws.eachRow(function (r) { r.eachCell(function (c) { todo.push(String(c.value)); }); }); });
  todo = todo.join(' | ');
  Ok('el Excel: las contraseñas salen tapadas', !/Abc123|X9z/.test(todo) && /\*\*\*\*/.test(todo));
}).catch(function (e) { fallos++; console.log('FAIL  el Excel: ' + e.message); }).then(function () {
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
});
