// tools/tests/AnalisisModoAutonomoHeadlessSmoke.js - Modo Autonomo en la pestana
// "Analisis de servicios" (analisis/analisis.js + analisis/modo_autonomo.js), en
// un Chrome de verdad.
//
// NO forma parte del sitio. Sirve el repositorio con el banco de siempre
// (BancoHeadless.js) y en memoria una copia de analisis/analisis.html con un
// fetch de mentira (la lista de servicios con Modo Autonomo y otro servicio,
// y la respuesta de accion=modo_autonomo; el otro servicio contesta 500) y una
// sonda que pulsa y apunta lo que ve. No escribe nada en disco.
//
//   M1-M4   la lista: Modo Autonomo sin "(sin reglas)" y con su leyenda; al
//           analizar, sus KPIs (con el ultimo mes abajo), hallazgos y sus siete
//           hojas (con la del mapa), sin avisos;
//   P1-P2   al escoger Modo Autonomo el periodo pasa al ano (boton "Este ano");
//           al cambiar a otro servicio regresa a los 6 meses;
//   S1-S2   la hoja del servidor de la tienda: lo que compara, sus tarjetas, las
//           barras apiladas (con su tip) y sus tablas, sin desbordar el ancho;
//   Z1-Z6   el zoom: clic en una barra abre el nivel 2, clic en un nombre el
//           nivel 3 (con "Sin detalle" en gris), las migas regresan y cada
//           hoja recuerda su nivel; el foco queda en el nivel actual;
//   X1      el Excel se arma (con el ExcelJS de la pagina);
//   E1-E2   si otro servicio falla, lo de Modo Autonomo se queda con el
//           aviso de que es la seleccion anterior y sus hojas;
//   L1-L5   ?servicio=modo_autonomo en la direccion lo abre solo: con el ano
//           (del 1 de enero a hoy, boton "Este ano"); con &meses=3, los ultimos
//           3 meses (con su boton marcado); con &desde y &hasta, esas fechas;
//           &meses fuera de rango se ignora; &meses=anio, el ano;
//   R1      sin errores de JavaScript.
//
//   node tools\tests\AnalisisModoAutonomoHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
//
// Sin Chrome instalado dice SKIP y sale 0. Otra ruta: CHROME=<ruta>.
'use strict';
var Banco = require('./BancoHeadless');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

if (!Banco.CHROME) { console.log('SKIP  sin Chrome/Edge (CHROME=<ruta> para indicar otro)'); process.exit(0); }

// ---- datos de mentira (los mismos de AnalisisModoAutonomoSmoke.js) ----
var SD = 'Sin detalle';
function ev(mes, tienda, origen, n2, n3, horas, respaldo, tickets) {
  return [mes, mes + '-10 10:00', String(horas), tienda == null ? null : String(tienda), tienda == null ? 'Varias sucursales' : 'Sucursal ' + tienda,
          'Modo Autónomo', 'Puntual', origen, '', respaldo ? '1' : '0', 'completo', n2, n3, 'causa', String(tickets || 0)];
}
function inc(mes, tienda, motivo, fuente, n2, n3, tickets) {
  return [mes, mes + '-05 09:00', tienda == null ? null : String(tienda), String(tickets), motivo, fuente, n2, n3, '0', 'parcial', '0'];
}
var MA = {
  servicio: 'modo_autonomo', desde: '2026-03-01', hasta: '2026-05-31',
  bloques: {
    parametros: { columnas: ['Clave', 'Valor'], filas: [['UltimaCargaExcel', '2026-11-20 07:51'], ['CargaTickets', '2026-11-20 07:51'], ['ReglasVersion', '2026-11-20']] },
    eventos: { columnas: ['Mes', 'Inicio', 'Horas', 'Tienda', 'TiendaNombre', 'Aplicacion', 'Tipo', 'Origen', 'OrigenDetalle', 'RespaldoFallo',
                          'Alcance', 'Nivel2', 'Nivel3', 'CausaIM', 'TicketsMA'], filas: [
      ev('2026-03', 101, 'electrica', 'El UPS no sostuvo', 'Sin pila o se descargó', 2, true, 3),
      ev('2026-03', 101, 'electrica', 'El UPS no sostuvo', 'Alarmado o se protegió', 1.5, true, 0),
      ev('2026-04', 102, 'electrica', 'El UPS no sostuvo', 'Sin pila o se descargó', 1, true, 1),
      ev('2026-04', 103, 'electrica', 'Planta de emergencia', SD, 4, true, 0),
      ev('2026-05', 101, 'comunicaciones', 'Red local de la tienda', 'Switch', 1, false, 2)] },
    incidentes: { columnas: ['Mes', 'Fecha', 'Tienda', 'Tickets', 'Motivo', 'Fuente', 'Nivel2', 'Nivel3', 'SinContacto', 'Alcance', 'TiendaConEventoIM'], filas: [
      inc('2026-03', 202, 'red_caja', 'documentado', 'Cable o nodo', 'Cable', 2),
      inc('2026-04', 202, 'red_caja', 'tienda', 'Cable o nodo', 'Nodo', 1),
      inc('2026-04', 201, 'probable_electrica', 'supuesto', 'La solución no dice la causa', '', 1)] }
  },
  // El servidor de la tienda (98), inventado como en AnalisisModoAutonomoSmoke.js.
  servidor: { disponible: true, bloques: {
    parametros: { columnas: ['Clave', 'Valor'], filas: [['UltimaLecturaPortal', '2026-06-01 08:00'], ['Servidores', '4'], ['NoAlcanzados', '0'],
      ['HorarioDesde', '7'], ['HorarioHasta', '23'], ['CorteMinimoMin', '5'], ['MargenEventoMin', '120'], ['TicketAntesMin', '120'], ['TicketDespuesMin', '240']] },
    fallas: { columnas: ['Mes', 'Inicio', 'Minutos', 'Tienda', 'TiendaNombre', 'Estado', 'Tipo', 'Causa', 'Horario', 'Cuenta', 'Reporte', 'CausaMA'], filas: [
      ['2026-03', '2026-03-10 09:00', '120', '101', 'Sucursal 101', 'Nuevo León', 'apagado', 'Falla eléctrica', '1', '1', 'evento', 'electrica'],
      ['2026-04', '2026-04-10 11:00', '60', '103', 'Sucursal 103', 'Nuevo León', 'apagado', 'Falla eléctrica', '1', '1', 'sin', null],
      ['2026-05', '2026-05-06 12:00', '18', '104', 'Sucursal 104', 'Coahuila', 'corte', 'Corte de red', '1', '1', 'sin', null]] },
    modoautonomo: { columnas: ['Fuente', 'Mes', 'Fecha', 'Tienda', 'Causa', 'Nivel2', 'Paso', 'PasoCausa', 'PasoInicio'], filas: [
      ['im', '2026-03', '2026-03-10 10:00', '101', 'electrica', 'El UPS no sostuvo', 'apagado', 'Falla eléctrica', '2026-03-10 09:00'],
      ['im', '2026-04', '2026-04-10 10:00', '102', 'electrica', 'El UPS no sostuvo', 'nada', null, null],
      ['ticket', '2026-04', '2026-04-05 09:00', '201', 'probable_electrica', 'La solución no dice la causa', 'nada', null, null]] },
    servidores: { columnas: ['Servidor', 'Tienda', 'TiendaNombre', 'Estado', 'LogDesde', 'RedDesde', 'Alcanzado'], filas: [['SRVPRB101', '101', 'Sucursal 101', 'Nuevo León', '2026-01-01', '2026-01-01', '1']] },
    causas: { columnas: ['Tipo', 'Causa', 'Total', 'EnHorario', 'Servidores', 'SinReporte'], filas: [['apagado', 'Falla eléctrica', '2', '2', '2', '1'], ['corte', 'Corte de red', '1', '1', '1', '1']] }
  } }
};
var SERVICIOS = { servicios: [
  { Servicio: 'modo_autonomo', Nombre: 'Modo Autónomo', Descripcion: 'Por qué las tiendas se quedan en Modo Autónomo', DesdeSugerido: '2026-01-01', ReglasVersion: '1', Reglas: '0', Criterios: '0' },
  { Servicio: 'otro', Nombre: 'Otro servicio', Descripcion: 'x', DesdeSugerido: null, ReglasVersion: '3', Reglas: '12', Criterios: '2' }] };

var STUB = '<script>\n' +
  'window.__pedidas = []; window.__blobs = [];\n' +
  'window.fetch = function (u) { u = String(u); __pedidas.push(u);\n' +
  '  var j, ok = true;\n' +
  '  if (u.indexOf("accion=servicios") >= 0) j = ' + JSON.stringify(SERVICIOS) + ';\n' +
  '  else if (u.indexOf("accion=modo_autonomo") >= 0) j = ' + JSON.stringify(MA) + ';\n' +
  '  else { ok = false; j = { error: "el otro servicio esta caido" }; }\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: ok, status: ok ? 200 : 500,\n' +
  '    json: function () { return Promise.resolve(JSON.parse(JSON.stringify(j))); },\n' +
  '    arrayBuffer: function () { return Promise.resolve(new TextEncoder().encode(JSON.stringify(j)).buffer); } }); }, 30); }); };\n' +
  'URL.createObjectURL = function (b) { __blobs.push(b.size); return "blob:prueba"; };\n' +
  'URL.revokeObjectURL = function () {};\n' +
  'HTMLAnchorElement.prototype.click = function () {};\n' +
  '</script>\n';

// ---- la sonda (corre en la pagina) ----
function sonda() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function $(id) { return document.getElementById('an-' + id); }
  function espera(cond, ms) {
    return new Promise(function (ok) {
      var t0 = Date.now();
      (function mira() { if (cond() || Date.now() - t0 > (ms || 4000)) return ok(cond()); setTimeout(mira, 20); })();
    });
  }
  function clic(el) { if (el) el.dispatchEvent(new MouseEvent('click', { bubbles: true })); return !!el; }
  function migas() { return Array.prototype.map.call($('panel').querySelectorAll('.an-migas b, .an-migas button'), function (x) { return x.textContent; }); }
  function barras() { return Array.prototype.map.call($('panel').querySelectorAll('[data-ma-zoom]'), function (x) { return x.getAttribute('data-ma-zoom'); }); }
  function fin() {
    R.push(['R1', errores]);
    var pre = document.createElement('pre'); pre.id = '__res'; pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  }
  var deLiga = /servicio=modo_autonomo/.test(location.search);
  espera(function () { return $('servicio').querySelector('option[value="modo_autonomo"]'); }).then(function () {
    if (deLiga) {
      return espera(function () { return /Eventos de los IMs/.test($('kpis').textContent); }).then(function (ok) {
        var boton = document.querySelector('#an-filtros [data-meses][aria-pressed="true"]');
        var pedidas = __pedidas.filter(function (u) { return /accion=modo_autonomo/.test(u); });
        R.push(['L', [ok, $('servicio').value, $('desde').value, $('hasta').value, boton ? boton.getAttribute('data-meses') : null,
                      pedidas.length, (pedidas[0] || '').replace(/^.*accion=modo_autonomo/, '')]]);
      });
    }
    R.push(['M1', [$('servicio').querySelector('option[value="modo_autonomo"]').textContent, $('servicio').querySelector('option[value="otro"]').textContent,
                   /con zoom de causas/.test($('lista').textContent)]]);
    function marcado() { var b = document.querySelector('#an-filtros [data-meses][aria-pressed="true"]'); return b ? b.getAttribute('data-meses') : null; }
    R.push(['P0', [$('desde').value, marcado()]]);
    // Como la persona: escoge Modo Autonomo en la lista (change) y pulsa Analizar.
    $('servicio').value = 'modo_autonomo';
    $('servicio').dispatchEvent(new Event('change', { bubbles: true }));
    R.push(['P1', [$('desde').value, $('hasta').value, marcado()]]);
    clic($('analizar'));
    return espera(function () { return /Eventos de los IMs/.test($('kpis').textContent); }).then(function () {
      var tabs = Array.prototype.map.call($('pestanas').querySelectorAll('[data-hoja]'), function (b) { return b.textContent; });
      var sel = $('pestanas').querySelector('[aria-selected="true"]');
      R.push(['M2', [$('titulo').textContent, $('kpis').querySelectorAll('.kpi').length, $('kpis').querySelector('.kpi .val').textContent,
                     Array.prototype.map.call($('kpis').querySelectorAll('.an-mes'), function (x) { return x.textContent; }),
                     $('kpis').querySelectorAll('.kpi.sr').length]]);
      R.push(['M3', [tabs, sel && sel.getAttribute('data-hoja'), $('hallazgos').querySelectorAll('li').length, $('avisos').hidden, $('resultado').hidden, $('excel').disabled]]);
      R.push(['M4', /Excel de críticos cargado el 2026-11-20 07:51/.test($('sub').textContent)]);
      R.push(['Z1', [migas(), barras()]]);
      clic($('panel').querySelector('rect[data-ma-zoom="electrica"]'));
      return espera(function () { return /Falla eléctrica: nivel 2/.test($('panel').textContent); });
    }).then(function () {
      R.push(['Z2', [migas(), barras()]]);
      clic($('panel').querySelector('button.an-zoom[data-ma-zoom="El UPS no sostuvo"]'));
      return espera(function () { return /El UPS no sostuvo: nivel 3/.test($('panel').textContent); });
    }).then(function () {
      var gris = $('panel').querySelectorAll('.barra.apagada').length;
      R.push(['Z3', [migas(), barras(), document.activeElement && document.activeElement.textContent, gris]]);
      clic($('panel').querySelector('button.an-miga[data-ma-ruta="[\\"electrica\\"]"]'));
      return espera(function () { return /Falla eléctrica: nivel 2/.test($('panel').textContent); });
    }).then(function () {
      clic($('panel').querySelector('button.an-zoom[data-ma-zoom="Planta de emergencia"]'));
      return espera(function () { return /Planta de emergencia: nivel 3/.test($('panel').textContent); });
    }).then(function () {
      R.push(['Z4', [migas(), $('panel').querySelectorAll('.barra.apagada').length, barras()]]);
      clic($('pestanas').querySelector('[data-hoja="NoLlegan"]'));
      return espera(function () { return /Todos los motivos/.test($('panel').textContent); });
    }).then(function () {
      R.push(['Z5', [migas(), barras()]]);
      clic($('pestanas').querySelector('[data-hoja="Servidor"]'));
      return espera(function () { return /Qué se compara/.test($('panel').textContent); });
    }).then(function () {
      var p = $('panel'), seg = p.querySelector('.an-seg.sin'), fila = p.querySelector('.an-pila');
      R.push(['S1', [p.querySelectorAll('.kpi').length, p.querySelectorAll('.an-pila-fila').length, p.querySelectorAll('.an-leyenda').length,
                     seg ? seg.getAttribute('data-tip') : null, !!(fila && fila.getBoundingClientRect().width > 100 && seg.getBoundingClientRect().width > 10),
                     /En los eventos eléctricos del IM el servidor falló en el 50% \(1 de 2\)/.test(p.textContent)]]);
      R.push(['S2', [document.documentElement.scrollWidth <= window.innerWidth + 1, p.querySelectorAll('table').length,
                     /Fallas sin reporte, de la más reciente/.test(p.textContent)]]);
      clic($('pestanas').querySelector('[data-hoja="Causas"]'));
      return espera(function () { return /Planta de emergencia: nivel 3/.test($('panel').textContent); });
    }).then(function (recordo) {
      clic($('panel').querySelector('button.an-miga[data-ma-ruta="[]"]'));
      return espera(function () { return /Eventos por origen/.test($('panel').textContent); }).then(function (raiz) {
        R.push(['Z6', [recordo, raiz, migas()]]);
      });
    }).then(function () {
      clic($('excel'));
      return espera(function () { return __blobs.length > 0; }, 8000);
    }).then(function () {
      R.push(['X1', [__blobs.length, __blobs[0] > 4000, /Excel listo: Analisis_modo_autonomo_20260301_20260531\.xlsx/.test($('estado').textContent)]]);
      $('servicio').value = 'otro';
      $('servicio').dispatchEvent(new Event('change', { bubbles: true }));
      R.push(['P2', [$('desde').value, marcado()]]);
      clic($('analizar'));
      return espera(function () { return !$('error').hidden; });
    }).then(function () {
      R.push(['E1', [$('error-msg').textContent.indexOf('el otro servicio esta caido') >= 0, $('previo').hidden,
                     /Lo de abajo es la selección anterior: Modo Autónomo/.test($('previo').textContent)]]);
      var tabs = Array.prototype.map.call($('pestanas').querySelectorAll('[data-hoja]'), function (b) { return b.getAttribute('data-hoja'); });
      R.push(['E2', [tabs, $('excel').disabled]]);
    });
  }).then(fin, function (e) { errores.push('sonda: ' + e.message); fin(); });
}

var pagina = Banco.pagina('analisis/analisis.html', 'analisis.js', STUB, sonda);
// Hoy en Mexico, el primer dia de hace dos meses (lo que pone "3 meses"), el de hace
// cinco ("6 meses") y el 1 de enero ("Este ano").
function dos(n) { return (n < 10 ? '0' : '') + n; }
var hoy = new Date(Date.now() - 6 * 3600000), HOY = hoy.getUTCFullYear() + '-' + dos(hoy.getUTCMonth() + 1) + '-' + dos(hoy.getUTCDate());
function primero(atras) { var d = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() - atras, 1)); return d.getUTCFullYear() + '-' + dos(d.getUTCMonth() + 1) + '-01'; }
var TRES = primero(2), SEIS = primero(5), ANIO = hoy.getUTCFullYear() + '-01-01';
var URLS = ['/analisis/__ma.html', '/analisis/__ma.html?servicio=modo_autonomo', '/analisis/__ma.html?servicio=modo_autonomo&meses=3',
            '/analisis/__ma.html?servicio=modo_autonomo&desde=2026-09-01&hasta=2026-10-31', '/analisis/__ma.html?servicio=modo_autonomo&meses=40',
            '/analisis/__ma.html?servicio=modo_autonomo&meses=anio'];
Banco.correr({ '/analisis/__ma.html': pagina }, URLS, 20000).then(function (res) {
  var r = Banco.mapa(res[0]), l = Banco.mapa(res[1]), l3 = Banco.mapa(res[2]), lf = Banco.mapa(res[3]), lm = Banco.mapa(res[4]), la = Banco.mapa(res[5]);
  if (!res[0]) { console.log('FAIL  la pagina no dejo resultado'); process.exit(1); }
  Check('M1 la lista: Modo Autonomo sin "(sin reglas)", el otro igual, y su leyenda', ['Modo Autónomo', 'Otro servicio', true], r.M1);
  Check('P0 de entrada, los 6 meses de siempre', [SEIS, '6'], r.P0);
  Check('P1 al escoger Modo Autonomo: el ano, con su boton', [ANIO, HOY, 'anio'], r.P1);
  Check('P2 al cambiar a otro servicio: de regreso a 6 meses', [SEIS, '6'], r.P2);
  Check('M2 titulo y siete KPIs, cada uno con su ultimo mes; el del servidor en rojo',
        ['Modo Autónomo', 7, '5', ['Mayo: 1 (1 h)', 'Mayo: 1', 'Mayo: 0% (0)', 'Mayo: 0 de 0', 'Mayo: 0', 'Mayo: 1 de 1', 'Mayo: 0%'], 1], r.M2);
  Check('M3 sus siete hojas, Causas primero, hallazgos, sin avisos, Excel listo',
        [['Causas de los IMs', 'Lo que no llega al IM', 'El servidor de la tienda', 'Mapa por estado', 'Por mes', 'Tiendas', 'Detalle'], 'Causas', 6, true, false, false], r.M3);
  Check('M4 dice cuando se cargo el Excel', true, r.M4);
  Check('Z1 nivel 1: barras y nombres que abren', [['Todas las causas'], ['electrica', 'comunicaciones', 'electrica', 'comunicaciones']], r.Z1);
  Check('Z2 clic en la barra: nivel 2 de la electrica, con migas',
        [['Todas las causas', 'Falla eléctrica'], ['El UPS no sostuvo', 'Planta de emergencia', 'El UPS no sostuvo', 'Planta de emergencia']], r.Z2);
  Check('Z3 clic en el nombre: nivel 3, sin abrir mas; el foco en el nivel',
        [['Todas las causas', 'Falla eléctrica', 'El UPS no sostuvo'], [], 'El UPS no sostuvo', 0], r.Z3);
  Check('Z4 la miga regresa y "Sin detalle" sale en gris', [['Todas las causas', 'Falla eléctrica', 'Planta de emergencia'], 1, []], r.Z4);
  Check('Z5 lo que no llega al IM: su propio zoom', [['Todos los motivos'], ['red_caja', 'probable_electrica', 'red_caja', 'probable_electrica']], r.Z5);
  Check('S1 el servidor: sus 4 tarjetas, barras apiladas con su tip y una leyenda por seccion, y la frase de la electrica',
        [4, 5, 2, 'Se apagó sin aviso\n1 sin reporte', true, true], r.S1);
  Check('S2 el servidor: no desborda el ancho y trae sus cinco tablas', [true, 5, true], r.S2);
  Check('Z6 cada hoja recuerda su nivel; la miga de la raiz regresa', [true, true, ['Todas las causas']], r.Z6);
  Check('X1 el Excel', [1, true, true], r.X1);
  Check('E1 si otro servicio falla, se queda Modo Autonomo con el aviso', [true, false, true], r.E1);
  Check('E2 con sus hojas y su Excel', [['Causas', 'NoLlegan', 'Servidor', 'Mapa', 'Mes', 'Tiendas', 'Detalle'], false], r.E2);
  Check('L1 ?servicio=modo_autonomo lo abre solo, con el ano',
        [true, 'modo_autonomo', ANIO, HOY, 'anio', 1, '&desde=' + ANIO + '&hasta=' + HOY], l.L);
  Check('L2 &meses=3: los ultimos 3 meses, con su boton marcado',
        [true, 'modo_autonomo', TRES, HOY, '3', 1, '&desde=' + TRES + '&hasta=' + HOY], l3.L);
  Check('L3 &desde y &hasta: esas fechas, sin boton', [true, 'modo_autonomo', '2026-09-01', '2026-10-31', null, 1, '&desde=2026-09-01&hasta=2026-10-31'], lf.L);
  Check('L4 &meses fuera de rango (40): se ignora y va con el ano', [ANIO, 'anio'], [lm.L && lm.L[2], lm.L && lm.L[4]]);
  Check('L5 &meses=anio: el ano', [ANIO, HOY, 'anio'], [la.L && la.L[2], la.L && la.L[3], la.L && la.L[4]]);
  Check('R1 sin errores de JavaScript', [[], [], [], [], [], []], [r.R1, l.R1, l3.R1, lf.R1, lm.R1, la.R1]);
  console.log(fallos ? '\n' + fallos + ' FALLA(S)' : '\nTODO BIEN');
  process.exit(fallos ? 1 : 0);
});
