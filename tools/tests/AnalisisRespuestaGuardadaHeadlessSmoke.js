// tools/tests/AnalisisRespuestaGuardadaHeadlessSmoke.js - la cache en memoria
// de respuestas de analisis.ashx (analisis/analisis.js) en un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco). Un fetch de mentira
// hace de handlers/analisis.ashx y cuenta las peticiones del servicio.
//
//   G1-G2  un 200 con JSON truncado no queda guardado: Reintentar lo vuelve
//          a pedir y la respuesta buena se analiza.
//   G3     la respuesta buena si queda: el mismo analisis no la vuelve a pedir.
//   G4     un fallo del analisis (ya leido el cuerpo) no saca la guardada.
//   G5     un fallo al leer una guardada la saca: Reintentar la pide de nuevo.
//
//   node tools\tests\AnalisisRespuestaGuardadaHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
'use strict';
var Banco = require('./BancoHeadless');
if (!Banco.CHROME) { console.log('SKIP  sin Chrome ni Edge (CHROME=<ruta>)'); process.exit(0); }

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}

function bloque(columnas, filas) { return { columnas: columnas, filas: filas }; }
var COLS = ['CodigoTicket', 'Origen', 'Tipo', 'Categoria', 'Estado', 'Subestado', 'Prioridad', 'SLA', 'TipoRelacion', 'Grupo',
            'TipoSitio', 'SitioNumero', 'Tienda', 'FechaRegistro', 'FechaEstimadaResolucion', 'FechaFirmaSolucion',
            'FechaFirmaCierre', 'FechaUltimaModificacion', 'IntentosSolucion', 'ReasignacionesGrupo',
            'Titulo', 'Descripcion', 'SolucionUsuario'];
var tickets = [];
for (var i = 0; i < 30; i++) {
  var d = '2026-10-' + (i % 28 + 1 < 10 ? '0' : '') + (i % 28 + 1);
  tickets.push(['INC 2026-' + (100000 + i), 'Portal', 'Incidencia', '/S-Prueba/Falla', 'Cerrada', '', 'Media', 'Estandar', '', 'Mesa',
                'Tienda', String(1000 + i % 9), (1000 + i % 9) + ' Monterrey', d + ' 09:00:00', d + ' 20:00:00', d + ' 18:00:00',
                d + ' 19:00:00', '2026-11-01 08:00:00', '1', '0', 'No imprime', 'Falla en caja', 'Se reinicia']);
}
var MOTOR = {
  servicio: 'prueba', desde: '2026-10-01', hasta: '2026-10-31',
  bloques: {
    parametros: bloque(['Bloque', 'Clave', 'Valor'], [['0) Parametros', 'Servicio', 'S-Prueba']]),
    reglas: bloque(['Orden', 'Regla', 'Motivo', 'Campo', 'Frases'], [['1', 'R01', 'Impresora', 'D', '["imprime"]']]),
    tickets: bloque(COLS, tickets)
  }
};
var SERVICIOS = [{ Servicio: 'prueba', Nombre: 'S-Prueba', Descripcion: '', DesdeSugerido: null, ReglasVersion: '1', Reglas: 1 }];

// Sin Worker: el headless corre en tiempo virtual y el respaldo (trabajo.js
// como script) es el mismo codigo; ademas deja parchar AnalisisTrabajo.
// La primera respuesta del servicio es un 200 con el JSON cortado.
var STUB = '<script>\n' +
  'window.Worker = undefined;\n' +
  'window.__pedidas = 0; window.__malas = 1;\n' +
  'var __R = { motor: ' + JSON.stringify(MOTOR) + ', servicios: ' + JSON.stringify(SERVICIOS) + ' };\n' +
  'window.fetch = function (u) { u = String(u); var txt;\n' +
  '  if (/accion=servicios/.test(u)) txt = JSON.stringify({ servicios: __R.servicios });\n' +
  '  else { __pedidas++; txt = JSON.stringify(__R.motor); if (__malas > 0) { __malas--; txt = txt.slice(0, 60); } }\n' +
  '  return new Promise(function (ok) { setTimeout(function () { ok(new Response(txt, { status: 200, headers: { "Content-Type": "application/json" } })); }, 20); }); };\n' +
  '</script>\n';

// ---- la sonda (corre en la pagina) ----
function sonda() {
  var R = {}, errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn, max) { for (var t = 0; !fn() && t < (max || 6000); t += 25) await espera(25); return !!fn(); }
  function $(id) { return document.getElementById('an-' + id); }
  function errorVisible() { return !$('error').hidden; }
  function listo() { return /\bok\b/.test($('estado').className) && !errorVisible(); }
  function pide() { $('servicio').value = 'prueba'; $('analizar').click(); }
  function reintenta() { $('reintentar').click(); }
  // Falla una sola vez el paso dado de AnalisisTrabajo (cargar o analizar).
  function fallaUnaVez(paso) {
    var P = window.AnalisisTrabajo.prototype, orig = P[paso];
    P[paso] = function () { P[paso] = orig; throw new Error('fallo de prueba en ' + paso); };
  }
  function fin() {
    R.errores = errores;
    var pre = document.createElement('pre'); pre.id = '__res'; pre.textContent = JSON.stringify(R); document.body.appendChild(pre);
  }
  (async function () {
    try {
      await hasta(function () { return $('servicio').options.length && $('servicio').options[0].value; });
      pide();
      await hasta(errorVisible);
      R.G1 = [errorVisible(), !$('reintentar').hidden, window.__pedidas];
      reintenta();
      await hasta(listo);
      R.G2 = [listo(), window.__pedidas];

      pide();
      await hasta(listo);
      R.G3 = [window.__pedidas, /con la consulta de las/.test($('estado').textContent)];

      fallaUnaVez('analizar');
      pide();
      await hasta(errorVisible);
      R.G4a = [/fallo de prueba en analizar/.test($('error-msg').textContent), window.__pedidas];
      reintenta();
      await hasta(listo);
      R.G4b = [listo(), window.__pedidas];

      fallaUnaVez('cargar');
      pide();
      await hasta(errorVisible);
      R.G5a = [/fallo de prueba en cargar/.test($('error-msg').textContent), window.__pedidas];
      reintenta();
      await hasta(listo);
      R.G5b = [listo(), window.__pedidas];
    } catch (e) { errores.push('sonda: ' + (e && e.message)); }
    fin();
  })();
}

var html = Banco.pagina('analisis/analisis.html', 'analisis.js', STUB, sonda);
var P = '/analisis/__banco.html';
Banco.correr({ '/analisis/__banco.html': html }, [P], 60000).then(function (r) {
  var o = r[0] || {};
  Check('G1 200 con JSON truncado: error y Reintentar, una peticion', [true, true, 1], o.G1);
  Check('G2 Reintentar vuelve a pedir (no reusa lo roto) y analiza', [true, 2], o.G2);
  Check('G3 la respuesta buena queda guardada: no se vuelve a pedir', [2, true], o.G3);
  Check('G4a fallo del analisis con la guardada', [true, 2], o.G4a);
  Check('G4b la guardada sigue: Reintentar no vuelve a pedir', [true, 2], o.G4b);
  Check('G5a fallo al leer la guardada (sin pedir)', [true, 2], o.G5a);
  Check('G5b la guardada se saco: Reintentar vuelve a pedir', [true, 3], o.G5b);
  Check('G6 sin errores de pagina', [], o.errores);
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
