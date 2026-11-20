// tools/tests/AnalisisModoAutonomoSmoke.js - prueba de humo de
// analisis/modo_autonomo.js: el modelo, el zoom de causas, las hojas, las
// contraseñas tapadas en CausaIM y OrigenDetalle, y el Excel.
//
// NO forma parte del sitio. Usa el modo_autonomo.js REAL, el motor.js REAL
// (solo su ocultarClaves) y el vendor de ExcelJS de la pagina. Los datos son
// sinteticos con las columnas que lee modo_autonomo.js: el contrato real de
// usp_Analisis_ModoAutonomo (97) no esta en este repositorio y no se verifica.
//
//   node tools\tests\AnalisisModoAutonomoSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
'use strict';
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var MA = require(path.join(raiz, 'analisis', 'modo_autonomo.js'));
var Motor = require(path.join(raiz, 'analisis', 'motor.js'));
var ExcelJS = require(path.join(raiz, 'analisis', 'vendor', 'exceljs.min.js'));

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}
function Ok(caso, cond, detalle) { Check(caso, true, !!cond + (cond ? '' : '  (' + detalle + ')')); }

/* ------------------------------------------------------------------ datos */
function bloque(columnas, filas) { return { columnas: columnas, filas: filas }; }
var COL_EV = ['Mes', 'Inicio', 'Horas', 'Tienda', 'TiendaNombre', 'Aplicacion', 'Tipo', 'Origen', 'OrigenDetalle',
              'RespaldoFallo', 'Alcance', 'Nivel2', 'Nivel3', 'CausaIM', 'TicketsMA'];
var COL_IN = ['Mes', 'Fecha', 'Tienda', 'Tickets', 'Motivo', 'Fuente', 'Nivel2', 'Nivel3', 'SinContacto', 'Alcance', 'TiendaConEventoIM'];
function ev(mes, tienda, origen, n2, n3, extra) {
  var o = { Mes: mes, Inicio: mes + '-05 10:00:00', Horas: '2.5', Tienda: tienda == null ? null : String(tienda), TiendaNombre: 'Suc ' + tienda,
            Aplicacion: 'POS', Tipo: 'Modo Autonomo', Origen: origen, OrigenDetalle: '', RespaldoFallo: '0', Alcance: 'Tienda',
            Nivel2: n2, Nivel3: n3, CausaIM: 'Corte de luz', TicketsMA: '3' };
  Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
  return COL_EV.map(function (c) { return o[c]; });
}
function inc(mes, tienda, motivo, fuente, n2, n3) {
  return [mes, mes + '-07 08:00:00', String(tienda), '4', motivo, fuente, n2, n3, '0', 'Caja', '0'];
}
var eventos = [
  ev('2026-09', 101, 'electrica', 'El UPS no sostuvo', 'Sin pila', { RespaldoFallo: '1', CausaIM: 'UPS sin pila; la contraseña: Abc123! del NVR', OrigenDetalle: 'clave temporal X9z-7' }),
  ev('2026-09', 101, 'electrica', 'El UPS no sostuvo', 'Sin pila', { RespaldoFallo: '1' }),
  ev('2026-10', 102, 'electrica', 'El UPS no sostuvo', 'Sin detalle'),
  ev('2026-10', 103, 'electrica', 'Solo el corte', ''),
  ev('2026-10', 104, 'comunicaciones', 'Sin detalle', ''),
  ev('2026-10', null, 'servidor', 'Disco', 'Lleno'),
  ev('2026-10', 105, '', '', '')
];
var incidentes = [
  inc('2026-09', 101, 'red_caja', 'documentado', 'Cable', 'Roto'),
  inc('2026-10', 106, 'probable_electrica', 'supuesto', '', ''),
  inc('2026-10', 107, '', 'supuesto', '', '')
];
function respuesta(conCarga) {
  return {
    servicio: 'modo_autonomo', desde: '2026-09-01', hasta: '2026-10-31',
    bloques: {
      parametros: bloque(['Clave', 'Valor'], [['UltimaCargaExcel', '2026-11-19 08:00'], ['ReglasVersion', '2026-11-20']]
                         .concat(conCarga ? [['CargaTickets', '2026-11-19 09:00']] : [])),
      eventos: bloque(COL_EV, eventos),
      incidentes: bloque(COL_IN, incidentes)
    }
  };
}

/* ------------------------------------------------------------- contrato */
Ok('modelo sin ocultar lanza', (function () { try { MA.modelo(respuesta(true)); return false; } catch (e) { return /ocultarClaves/.test(e.message); } })(), 'no lanzo');
Check('el motor publica ocultarClaves', 'function', typeof Motor.ocultarClaves);
var m = MA.modelo(respuesta(true), Motor.ocultarClaves);
Check('servicio', 'modo_autonomo', m.servicio);
Check('cinco hojas', 'Causas,NoLlegan,Mes,Tiendas,Detalle', MA.HOJAS.map(function (h) { return h[0]; }).join(','));

/* -------------------------------------------------------------- cifras */
Check('eventos', 7, m.cifras.eventos);
Check('horas', 17.5, m.cifras.horas);
Check('tiendas (sin la de varias sucursales)', 5, m.cifras.tiendas);
Check('tiendas que repiten', 1, m.cifras.tiendasRepiten);
Check('electricas', 4, m.cifras.electricas);
Check('el respaldo no sostuvo', 2, m.cifras.respaldo);
Check('eventos sin detalle', 2, m.cifras.eventosSinDetalle);
Check('incidentes', 3, m.cifras.incidentes);
Check('tickets sueltos', 12, m.cifras.ticketsSueltos);
Check('supuestos', 2, m.cifras.supuestos);
Check('origen vacio = sincausa', 'sincausa', m.eventos[6].n1);
Check('motivo vacio = probable_electrica', 'probable_electrica', m.incidentes[2].n1);
Check('principal: electrica', 'Falla eléctrica', m.cifras.principal.nombre);
Check('sin avisos con carga y niveles', 0, m.avisos.length);

/* ------------------------------------------------------- contraseñas */
Ok('CausaIM tapada', /contraseña: \*\*\*\*/.test(m.eventos[0].causaIM) && !/Abc123/.test(m.eventos[0].causaIM), m.eventos[0].causaIM);
Ok('OrigenDetalle tapado', /clave temporal \*\*\*\*/.test(m.eventos[0].detalle) && !/X9z/.test(m.eventos[0].detalle), m.eventos[0].detalle);
Check('texto sin contraseña queda igual', 'Corte de luz', m.eventos[1].causaIM);
Check('vacio queda vacio', '', m.eventos[1].detalle);

/* --------------------------------------------------------------- zoom */
var e1 = m.arbolEventos;
Check('nivel 1: orden por eventos', 'electrica,comunicaciones,servidor,sincausa', e1.hijos.map(function (x) { return x.clave; }).join(','));
var b = MA.buscar(e1, ['electrica', 'El UPS no sostuvo']);
Check('nivel 3 por ruta', 'Sin pila,Sin detalle', b.nodo.hijos.map(function (x) { return x.clave; }).join(','));
Check('camino de migas', 3, b.camino.length);
Check('Sin detalle marcado', true, b.nodo.hijos[1].sinDetalle);
Check('ruta que ya no existe corta ahi', 'electrica', MA.buscar(e1, ['electrica', 'No existe', 'x']).nodo.clave);
Check('nivel 2 vacio cierra la rama', 0, MA.buscar(e1, ['sincausa']).nodo.hijos.length);
Check('tiendas del nodo', 2, MA.buscar(e1, ['electrica', 'El UPS no sostuvo']).nodo.tiendas);

/* -------------------------------------------------------------- panel */
function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
var dibujos = [];
var a = {
  esc: esc, ancho: function () { return 800; },
  horizontales: function (d) { dibujos.push(d); return '<svg data-barras="' + d.length + '"></svg>'; },
  columnas: function (d) { return '<svg data-columnas="' + d.length + '"></svg>'; }
};
var p1 = MA.panel(m, 'Causas', { Causas: [] }, a);
Ok('Causas nivel 1: migas y barras', /an-migas/.test(p1) && /data-barras="4"/.test(p1), p1.slice(0, 200));
Ok('Causas nivel 1: nombres con zoom', /data-ma-zoom="electrica"/.test(p1), 'sin zoom');
Check('barra con hijos lleva zoom; sin hijos no', 'electrica|null', String(dibujos[0][0].zoom) + '|' + String(dibujos[0][3].zoom));
var p2 = MA.panel(m, 'Causas', { Causas: ['electrica'] }, a);
Ok('Causas nivel 2: titulo y miga de regreso', /Falla eléctrica: nivel 2/.test(p2) && /data-ma-ruta="\[\]"/.test(p2), p2.slice(0, 300));
var p3 = MA.panel(m, 'Causas', { Causas: ['electrica', 'El UPS no sostuvo'] }, a);
Ok('Causas nivel 3: miga al nivel 2', /data-ma-ruta="\[&quot;electrica&quot;\]"/.test(p3), p3.slice(0, 300));
Check('Sin detalle sale apagada', true, dibujos[2].filter(function (x) { return x.e === 'Sin detalle'; })[0].apagada);
Ok('hoja sin hijos: no se abre mas', /no se abre más/.test(MA.panel(m, 'Causas', { Causas: ['sincausa'] }, a)), 'falta nota');
Ok('NoLlegan nivel 1', /Incidentes por motivo/.test(MA.panel(m, 'NoLlegan', {}, a)), 'falta titulo');
Ok('Mes: dos graficas', /data-columnas="2"[\s\S]*data-columnas="2"/.test(MA.panel(m, 'Mes', {}, a)), 'faltan');
Ok('Tiendas: la 101 primero', /<td>101<\/td>/.test(MA.panel(m, 'Tiendas', {}, a)), 'falta');
var det = MA.panel(m, 'Detalle', {}, a);
Ok('Detalle: CausaIM tapada en pantalla', /\*\*\*\*/.test(det) && !/Abc123/.test(det), 'aparece');
Ok('Detalle: escapa HTML', (function () {
  var r = respuesta(true); r.bloques.eventos.filas = [ev('2026-10', 1, 'ups', '<b>x</b>', '', { CausaIM: '<img src=x onerror=1>' })];
  var h = MA.panel(MA.modelo(r, Motor.ocultarClaves), 'Detalle', {}, a);
  return h.indexOf('<img') < 0 && h.indexOf('<b>x') < 0;
})(), 'sin escapar');
Check('hoja desconocida', '', MA.panel(m, 'Nada', {}, a));

/* ------------------------------------------------------------- avisos */
var sinCarga = MA.modelo(respuesta(false), Motor.ocultarClaves);
Ok('sin CargaTickets: aviso', sinCarga.avisos.some(function (x) { return /crit\.TicketMA/.test(x); }), sinCarga.avisos.join(' / '));
var r2 = respuesta(true); r2.bloques.eventos.filas = [ev('2026-10', 1, 'electrica', '', '')];
Ok('sin niveles: aviso', MA.modelo(r2, Motor.ocultarClaves).avisos.some(function (x) { return /nivel 2 y 3/.test(x); }), 'falta');
var vacio = MA.modelo({ desde: '2026-01-01', hasta: '2026-01-31', bloques: { parametros: bloque(['Clave', 'Valor'], []) } }, Motor.ocultarClaves);
Check('sin datos: cero eventos', 0, vacio.cifras.eventos);
Ok('sin datos: hallazgo que lo dice', /No hay eventos/.test(vacio.hallazgos[0]), vacio.hallazgos.join(' / '));
Ok('sin datos: panel sin datos', /Sin datos en el periodo/.test(MA.panel(vacio, 'Causas', {}, a)), 'falta');
Check('KPIs: seis', 6, MA.kpis(m).length);
Ok('KPIs sin NaN', !/NaN|Infinity/.test(JSON.stringify(MA.kpis(vacio)) + JSON.stringify(MA.kpis(m))), 'aparece');

/* ------------------------------------------------------------- Excel */
(async function () {
  var buf = await MA.armarLibro(m, ExcelJS).xlsx.writeBuffer();
  var wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
  var hojas = [], texto = {};
  wb.eachSheet(function (ws) {
    hojas.push(ws.name);
    var t = []; ws.eachRow(function (r) { r.eachCell(function (c) { t.push(String(c.value)); }); }); texto[ws.name] = t.join('\n');
  });
  Check('Excel: siete hojas', 'Resumen,Causas de los IMs,No llegan al IM,Por mes,Tiendas,Eventos,Incidentes sin IM', hojas.join(','));
  var todo = JSON.stringify(texto);
  Ok('Excel: contraseñas tapadas', !/Abc123|X9z/.test(todo) && /\*\*\*\*/.test(texto.Eventos), 'aparece');
  Ok('Excel: causas con nivel 3', /Sin pila/.test(texto['Causas de los IMs']), 'falta');
  Ok('Excel: sin NaN', !/NaN|Infinity/.test(todo), 'aparece');
  var vbuf = await MA.armarLibro(vacio, ExcelJS).xlsx.writeBuffer();
  Ok('Excel sin datos se arma', vbuf && vbuf.byteLength > 0, 'vacio');

  console.log(fallos ? '\n' + fallos + ' caso(s) fallaron' : '\nTodo paso');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
