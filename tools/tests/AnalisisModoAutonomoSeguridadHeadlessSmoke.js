// tools/tests/AnalisisModoAutonomoSeguridadHeadlessSmoke.js - Modo Autonomo en la
// pagina suelta analisis/analisis.html, en un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco). Un fetch de mentira
// hace de handlers/analisis.ashx: la lista de servicios (con o sin
// modo_autonomo), un servicio de motor ("prueba", tickets sinteticos) y
// accion=modo_autonomo (datos, 400 o 500).
//
//   M1-M8  motor -> Modo Autonomo -> motor: pestañas 7/6/7, zoom con clics
//          (nombre, barra, migas), contraseñas tapadas en Detalle, el Excel
//          de cada vista, sin errores de pagina.
//   S1-S2  sin modo_autonomo en la lista (?sinma=1): no sale ni se pide,
//          ni con la liga directa.
//   L1     liga directa ?servicio=modo_autonomo: se analiza sola, con el año
//          (no con DesdeSugerido).
//   E1-E3  500 (falta el procedimiento) despues de un analisis de motor: el
//          mensaje del servidor (la pista de 97 solo sale si no trae uno, como
//          la de 47 en el motor), Reintentar, lo de antes sigue y su Excel es el del motor;
//          el motor sigue sirviendo. 400 (inactivo): su mensaje, sin pista de 97.
//
//   node tools\tests\AnalisisModoAutonomoSeguridadHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
'use strict';
var Banco = require('./BancoHeadless');
if (!Banco.CHROME) { console.log('SKIP  sin Chrome ni Edge (CHROME=<ruta>)'); process.exit(0); }

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}

/* ------------------------------------------------------------ respuestas */
function bloque(columnas, filas) { return { columnas: columnas, filas: filas }; }
var COLS = ['CodigoTicket', 'Origen', 'Tipo', 'Categoria', 'Estado', 'Subestado', 'Prioridad', 'SLA', 'TipoRelacion', 'Grupo',
            'TipoSitio', 'SitioNumero', 'Tienda', 'FechaRegistro', 'FechaEstimadaResolucion', 'FechaFirmaSolucion',
            'FechaFirmaCierre', 'FechaUltimaModificacion', 'IntentosSolucion', 'ReasignacionesGrupo',
            'Titulo', 'Descripcion', 'SolucionUsuario'];
var tickets = [];
for (var i = 0; i < 60; i++) {
  var d = '2026-10-' + (i % 28 + 1 < 10 ? '0' : '') + (i % 28 + 1);
  tickets.push(['INC 2026-' + (100000 + i), 'Portal', 'Incidencia', '/S-Prueba/Falla', 'Cerrada', '', 'Media', 'Estandar', '', 'Mesa',
                'Tienda', String(1000 + i % 9), (1000 + i % 9) + ' Monterrey', d + ' 09:00:00', d + ' 20:00:00', d + ' 18:00:00',
                d + ' 19:00:00', '2026-11-01 08:00:00', '1', '0', i % 3 ? 'No enciende' : 'No imprime', 'Falla en caja', 'Se reinicia']);
}
var MOTOR = {
  servicio: 'prueba', desde: '2026-10-01', hasta: '2026-10-31',
  bloques: {
    parametros: bloque(['Bloque', 'Clave', 'Valor'], [['0) Parametros', 'Servicio', 'S-Prueba']]),
    reglas: bloque(['Orden', 'Regla', 'Motivo', 'Campo', 'Frases'], [['1', 'R01', 'Impresora', 'D', '["imprime"]']]),
    tickets: bloque(COLS, tickets)
  }
};
var COL_EV = ['Mes', 'Inicio', 'Horas', 'Tienda', 'TiendaNombre', 'Aplicacion', 'Tipo', 'Origen', 'OrigenDetalle',
              'RespaldoFallo', 'Alcance', 'Nivel2', 'Nivel3', 'CausaIM', 'TicketsMA'];
function ev(t, o, n2, n3, causa) { return ['2026-10', '2026-10-05 10:00:00', '2', String(t), 'Suc ' + t, 'POS', 'MA', o, '', '0', 'Tienda', n2, n3, causa || 'Corte', '1']; }
var MA = {
  servicio: 'modo_autonomo', desde: '2026-09-01', hasta: '2026-10-31',
  bloques: {
    parametros: bloque(['Clave', 'Valor'], [['UltimaCargaExcel', '2026-11-19'], ['CargaTickets', '2026-11-19']]),
    eventos: bloque(COL_EV, [ev(1, 'electrica', 'El UPS no sostuvo', 'Sin pila', 'la contraseña: Abc123! del NVR'),
                             ev(2, 'electrica', 'El UPS no sostuvo', 'Sin pila'), ev(3, 'electrica', 'Solo el corte', ''),
                             ev(4, 'comunicaciones', 'Enlace', 'Caido')]),
    incidentes: bloque(['Mes', 'Fecha', 'Tienda', 'Tickets', 'Motivo', 'Fuente', 'Nivel2', 'Nivel3', 'SinContacto', 'Alcance', 'TiendaConEventoIM'],
                       [['2026-10', '2026-10-07 08:00:00', '9', '2', 'red_caja', 'documentado', 'Cable', '', '0', 'Caja', '0']])
  }
};
var SERVICIOS = [
  { Servicio: 'prueba', Nombre: 'S-Prueba', Descripcion: '', DesdeSugerido: null, ReglasVersion: '1', Reglas: 1 },
  { Servicio: 'modo_autonomo', Nombre: 'Modo Autónomo', Descripcion: 'IMs', DesdeSugerido: '2026-09-01', ReglasVersion: null, Reglas: 0 }
];

// El Worker corre en tiempo real y el headless en tiempo virtual: sin el,
// analisis.js usa su respaldo (trabajo.js como script), que es el mismo codigo.
var STUB = '<script>\n' +
  'window.Worker = undefined;\n' +
  'window.__peticiones = []; window.__bajadas = [];\n' +
  'var __q = location.search;\n' +
  'var __R = { motor: ' + JSON.stringify(MOTOR) + ', ma: ' + JSON.stringify(MA) + ', servicios: ' + JSON.stringify(SERVICIOS) + ' };\n' +
  'window.fetch = function (u) { u = String(u); __peticiones.push(u.replace(/^.*analisis\\.ashx/, ""));\n' +
  '  var st = 200, j;\n' +
  '  if (/accion=servicios/.test(u)) j = { servicios: __R.servicios.filter(function (s) { return !/sinma=1/.test(__q) || s.Servicio !== "modo_autonomo"; }) };\n' +
  '  else if (/accion=modo_autonomo/.test(u)) {\n' +
  '    if (/ma500=1/.test(__q)) { st = 500; j = { error: "El servidor de SQL rechazo la consulta (error 2812).", tipo: "SqlException" }; }\n' +
  '    else if (/ma400=1/.test(__q)) { st = 400; j = { error: "El servicio \\"modo_autonomo\\" no existe o no esta activo.", tipo: "SolicitudInvalida" }; }\n' +
  '    else j = __R.ma;\n' +
  '  } else j = __R.motor;\n' +
  '  return new Promise(function (ok) { setTimeout(function () { ok(new Response(JSON.stringify(j), { status: st, headers: { "Content-Type": "application/json" } })); }, 20); }); };\n' +
  // La descarga se apunta en lugar de hacerse.
  'HTMLAnchorElement.prototype.click = function () { if (this.download) __bajadas.push(this.download); };\n' +
  '</script>\n';

// ---- la sonda (corre en la pagina) ----
function sonda() {
  var R = {}, errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn, max) { for (var t = 0; !fn() && t < (max || 8000); t += 25) await espera(25); return !!fn(); }
  function $(id) { return document.getElementById('an-' + id); }
  function pestanas() { return Array.prototype.map.call(document.querySelectorAll('#an-pestanas [data-hoja]'), function (b) { return b.dataset.hoja; }).join(','); }
  function opciones() { return Array.prototype.map.call($('servicio').options, function (o) { return o.value + '|' + o.textContent; }); }
  function panel() { return $('panel').innerHTML; }
  function pide(clave) { $('servicio').value = clave; $('analizar').click(); }
  function errorVisible() { return !$('error').hidden; }
  function maPedidas() { return window.__peticiones.filter(function (u) { return /accion=modo_autonomo/.test(u); }); }
  function fin() {
    R.errores = errores;
    var pre = document.createElement('pre'); pre.id = '__res'; pre.textContent = JSON.stringify(R); document.body.appendChild(pre);
  }
  var q = location.search;
  (async function () {
    try {
      await hasta(function () { return $('servicio').options.length && $('servicio').options[0].value; });
      R.opciones = opciones();
      if (/sinma=1/.test(q)) {
        await espera(300);
        R.S = [R.opciones.some(function (o) { return /^modo_autonomo/.test(o); }), maPedidas().length, $('resultado').hidden];
      } else if (/servicio=modo_autonomo/.test(q)) {
        await hasta(function () { return pestanas() === 'Causas,NoLlegan,Servidor,Mes,Tiendas,Detalle'; });
        R.L = [pestanas(), $('desde').value, maPedidas()[0] || null, $('resultado').hidden];
      } else if (/ma500=1/.test(q)) {
        pide('prueba');
        await hasta(function () { return pestanas().split(',').length === 7 && !$('excel').disabled; }, 20000);
        pide('modo_autonomo');
        await hasta(errorVisible);
        R.E1 = [/error 2812/.test($('error-msg').textContent) && !/97_analisis/.test($('error-msg').textContent), !$('reintentar').hidden, pestanas().split(',').length,
                !$('previo').hidden && /S-Prueba/.test($('previo').textContent), $('excel').disabled];
        $('excel').click(); await hasta(function () { return window.__bajadas.length; }, 20000);
        R.E1x = window.__bajadas.slice();
        pide('prueba');
        await hasta(function () { return !errorVisible() && $('previo').hidden && !$('excel').disabled; }, 20000);
        R.E2 = [errorVisible(), pestanas().split(',').length];
      } else if (/ma400=1/.test(q)) {
        pide('modo_autonomo');
        await hasta(errorVisible);
        R.E3 = [$('error-msg').textContent, $('resultado').hidden];
      } else {
        pide('prueba');
        await hasta(function () { return pestanas().split(',').length === 7 && !$('excel').disabled; }, 20000);
        R.M1 = [pestanas(), $('titulo').textContent];
        pide('modo_autonomo');
        await hasta(function () { return pestanas() === 'Causas,NoLlegan,Servidor,Mes,Tiendas,Detalle' && !$('excel').disabled; });
        R.M2 = [pestanas(), $('titulo').textContent, document.querySelectorAll('#an-kpis .kpi').length];
        document.querySelector('#an-pestanas [data-hoja="Causas"]').click(); await espera(20);
        R.M3a = /Eventos por origen/.test(panel());
        document.querySelector('#an-panel button.an-zoom[data-ma-zoom="electrica"]').click(); await espera(20);
        R.M3b = [/Falla eléctrica: nivel 2/.test(panel()), document.activeElement && document.activeElement.tagName];
        var barra = document.querySelector('#an-panel rect.hit.zoom[data-ma-zoom="El UPS no sostuvo"]');
        if (barra) barra.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        await espera(20);
        R.M3c = [!!barra, /El UPS no sostuvo: nivel 3/.test(panel())];
        var migas = document.querySelectorAll('#an-panel .an-miga');
        R.M3d = migas.length;
        migas[0].click(); await espera(20);
        R.M3e = /Eventos por origen/.test(panel());
        document.querySelector('#an-pestanas [data-hoja="Detalle"]').click(); await espera(20);
        R.M4 = [/contraseña: \*\*\*\*/.test(panel()), /Abc123/.test(panel())];
        $('excel').click(); await hasta(function () { return window.__bajadas.length; }, 20000);
        R.M5 = window.__bajadas.slice();
        pide('prueba');
        await hasta(function () { return pestanas().split(',').length === 7 && $('titulo').textContent !== 'Modo Autónomo' && !$('excel').disabled; }, 20000);
        R.M6 = [pestanas(), /Eventos por origen|an-migas/.test(panel())];
        $('excel').click(); await hasta(function () { return window.__bajadas.length > 1; }, 20000);
        R.M7 = window.__bajadas.slice(1);
        pide('modo_autonomo');
        await hasta(function () { return pestanas() === 'Causas,NoLlegan,Servidor,Mes,Tiendas,Detalle'; });
        R.M8 = [pestanas(), maPedidas().length];
      }
    } catch (e) { errores.push('sonda: ' + (e && e.message)); }
    fin();
  })();
}

var html = Banco.pagina('analisis/analisis.html', 'analisis.js', STUB, sonda);
var P = '/analisis/__banco.html';
Banco.correr({ '/analisis/__banco.html': html },
  [P, P + '?sinma=1', P + '?sinma=1&servicio=modo_autonomo', P + '?servicio=modo_autonomo', P + '?ma500=1', P + '?ma400=1'], 30000)
  .then(function (r) {
    var o = r[0] || {}, s = r[1] || {}, s2 = r[2] || {}, l = r[3] || {}, e5 = r[4] || {}, e4 = r[5] || {};
    var SIETE = 'Resumen,Temporal,Sitios,Motivos,Atencion,Reglas,Detalle', SEIS = 'Causas,NoLlegan,Servidor,Mes,Tiendas,Detalle';
    Check('M0 lista: Modo Autonomo sin "(sin reglas)"', ['prueba|S-Prueba', 'modo_autonomo|Modo Autónomo'], o.opciones);
    Check('M1 motor: siete hojas', [SIETE, 'S-Prueba'], o.M1);
    Check('M2 Modo Autonomo: seis hojas, titulo, siete KPIs', [SEIS, 'Modo Autónomo', 7], o.M2);
    Check('M3a Causas: nivel 1', true, o.M3a);
    Check('M3b clic en el nombre: nivel 2 y foco en la miga actual', [true, 'B'], o.M3b);
    Check('M3c clic en la barra: nivel 3', [true, true], o.M3c);
    Check('M3d dos migas para regresar', 2, o.M3d);
    Check('M3e la primera miga regresa al nivel 1', true, o.M3e);
    Check('M4 Detalle: contraseña de CausaIM tapada', [true, false], o.M4);
    Check('M5 Excel de Modo Autonomo', ['Analisis_modo_autonomo_20260901_20261031.xlsx'], o.M5);
    Check('M6 de vuelta al motor: sus siete hojas, sin el zoom', [SIETE, false], o.M6);
    Check('M7 Excel del motor (no el de Modo Autonomo)', true, !!(o.M7 && o.M7.length === 1 && !/modo_autonomo/.test(o.M7[0])));
    Check('M8 otra vez Modo Autonomo: seis hojas, segunda peticion', [SEIS, 2], o.M8);
    Check('M9 sin errores de pagina', [], o.errores);
    Check('S1 sin registro: no sale, no se pide, nada en pantalla', [false, 0, true], s.S);
    Check('S2 sin registro + liga directa: tampoco', [false, 0, true], s2.S);
    Check('S3 sin errores', [[], []], [s.errores, s2.errores]);
    var ENERO = new Date().getFullYear() + '-01-01';
    Check('L1 liga directa: analiza sola, con el año', [SEIS, ENERO, true, false],
          l.L ? [l.L[0], l.L[1], l.L[2].indexOf('accion=modo_autonomo&desde=' + ENERO) >= 0, l.L[3]] : null);
    Check('E1 500: el mensaje del servidor (la pista de 97 solo sale sin el), Reintentar, motor sigue en pantalla con su aviso y su Excel', [true, true, 7, true, false], e5.E1);
    Check('E1x el Excel tras el fallo es el del motor', true, !!(e5.E1x && e5.E1x.length === 1 && !/modo_autonomo/.test(e5.E1x[0])));
    Check('E2 el motor sigue sirviendo despues del fallo', [false, 7], e5.E2);
    Check('E3 400: su mensaje sin pista de 97; nada en pantalla', ['El servicio "modo_autonomo" no existe o no esta activo.', true], e4.E3);
    Check('E4 sin errores', [[], []], [e5.errores, e4.errores]);
    console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
    process.exit(fallos === 0 ? 0 : 1);
  });
