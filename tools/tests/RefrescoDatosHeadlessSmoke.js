// tools/tests/RefrescoDatosHeadlessSmoke.js - refresco automatico y boton
// "Actualizar" de los tableros, en un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco).
//
// Datos: los de assets/js/mock-data.js, encendidos SOLO en la copia en
// memoria de la pagina (MOCK_DATA = true; el repo sigue en false). Se
// envuelve MockData.obtenerJSONMock para contar peticiones, cambiar el sello
// del origen (__v), hacerlas fallar (__falla) o lentas (__lento ms).
//
//   A  dashboard.html, SLA, con RefrescoAuto.INTERVALO_DATOS = 1500 ms:
//      A1 arranque con "Consultado"; A2 al cumplirse el intervalo pide UNA
//      vez y pinta el sello nuevo; A3 pagina oculta: no pide; A4 al volver
//      a visible pide una vez; A5 con una fecha con el foco: no pide;
//      A6 una peticion lenta no se encima (nunca dos kpis a la vez);
//      A7 un fallo no avanza "Consultado" y deja los datos y el aviso;
//      A8 Actualizar pide ya; A9 en otra pestaña (Backlog) SLA no se pide.
//   B  backlog/backlog.html suelta: B1 Actualizar trae el sello nuevo y
//      conserva Criticos elegida y las filas filtradas; B2 dos clics
//      seguidos = una peticion; B3 un fallo deja datos, sello y
//      "Consultado" y agrega el aviso; B4 la siguiente buena lo quita.
//
//   node tools\tests\RefrescoDatosHeadlessSmoke.js   # sale 0 si todo paso
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

// Envoltura del mock: cuenta, cambia el sello y simula fallas / lentitud.
function envoltura(intervalo) {
  return '<script>window.MockData.MOCK_DATA = true; Element.prototype.scrollIntoView = function () {};\n' +
    (intervalo ? 'window.RefrescoAuto.INTERVALO_DATOS = ' + intervalo + ';\n' : '') +
    '(function () {\n' +
    '  var orig = window.MockData.obtenerJSONMock;\n' +
    '  window.__v = 1; window.__falla = false; window.__lento = 0; window.__pedidas = {}; window.__enVuelo = 0; window.__maxVuelo = 0;\n' +
    '  window.__oculto = false;\n' +
    '  Object.defineProperty(document, "hidden", { configurable: true, get: function () { return window.__oculto; } });\n' +
    '  var SELLO = { 1: "2026-10-29T08:00:00", 2: "2026-10-30T09:15:00", 3: "2026-10-30T11:40:00" };\n' +
    '  window.MockData.obtenerJSONMock = function (ruta) {\n' +
    '    var base = String(ruta).split("?")[0].split("/").pop();\n' +
    '    window.__pedidas[base] = (window.__pedidas[base] || 0) + 1;\n' +
    '    var conMeta = base === "kpis.ashx" || base === "backlog_resumen.ashx";\n' +
    '    if (conMeta) { window.__enVuelo++; window.__maxVuelo = Math.max(window.__maxVuelo, window.__enVuelo); }\n' +
    '    var falla = window.__falla, v = window.__v;\n' +
    '    return new Promise(function (ok) { setTimeout(ok, conMeta ? window.__lento : 0); }).then(function () {\n' +
    '      if (conMeta) window.__enVuelo--;\n' +
    '      if (falla) throw new Error(base + " -> HTTP 500. caido");\n' +
    '      var d = orig(ruta);\n' +
    '      if (!conMeta) return d;\n' +
    '      d = JSON.parse(JSON.stringify(d));\n' +
    '      d.meta = Object.assign({}, d.meta || {}, { ultimaActualizacion: SELLO[v] });\n' +
    '      return d;\n' +
    '    });\n' +
    '  };\n' +
    '})();</script>\n';
}

function sondaDashboard() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn, tope) { for (var t = 0; !fn() && t < (tope || 4000); t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  function lineas() {
    return Array.prototype.map.call(document.querySelectorAll('#estado-carga .datos-info-linea'), function (d) { return d.textContent; });
  }
  function texto() { return lineas().join(' | '); }
  function consultado() { return lineas().filter(function (l) { return /^Consultado: /.test(l); })[0] || null; }
  function kpis() { return window.__pedidas['kpis.ashx'] || 0; }
  (async function () {
    try {
      await hasta(function () { return /29\/10\/2026/.test(texto()) && !!consultado(); });
      var k0 = kpis();
      apunta('A1', [/29\/10\/2026 · 08:00/.test(texto()), /^Consultado: \d\d\/\d\d\/\d{4} · \d\d:\d\d$/.test(consultado() || '')]);
      window.__v = 2;
      await hasta(function () { return /30\/10\/2026 · 09:15/.test(texto()); }, 3000);
      await espera(100);
      apunta('A2', [kpis() - k0, /30\/10\/2026 · 09:15/.test(texto()), !!consultado()]);
      // A3 oculta: pasa mas de un intervalo sin pedir.
      window.__oculto = true;
      var k1 = kpis();
      await espera(3500);
      apunta('A3', kpis() - k1);
      // A4 vuelve: una sola vez, en ese momento.
      window.__oculto = false;
      document.dispatchEvent(new Event('visibilitychange'));
      document.dispatchEvent(new Event('visibilitychange'));
      await espera(300);
      apunta('A4', kpis() - k1);
      // A5 una fecha con el foco: no se refresca.
      var f = document.getElementById('f-inicio');
      f.focus();
      var k2 = kpis();
      await espera(3500);
      apunta('A5', [document.activeElement === f, kpis() - k2]);
      f.blur();
      // A6 lenta (4 s > intervalo de 1.5 s): nunca dos kpis a la vez.
      window.__maxVuelo = 0; window.__lento = 4000;
      await espera(6000);
      window.__lento = 0;
      await espera(500);
      apunta('A6', window.__maxVuelo);
      // A7 falla: datos y "Consultado" se quedan; aviso aparte.
      await hasta(function () { return window.__enVuelo === 0; }, 5000);
      var antes = consultado(), filasAntes = document.querySelectorAll('#kpis .kpi').length;
      window.__falla = true;
      await hasta(function () { return /No se pudo actualizar/.test(texto()); }, 4000);
      apunta('A7', [/No se pudo actualizar/.test(texto()), consultado() === antes, /30\/10\/2026 · 09:15/.test(texto()),
                    document.querySelectorAll('#kpis .kpi').length === filasAntes && filasAntes > 0]);
      window.__falla = false;
      // A8 Actualizar: pide ya, con sello nuevo, y el aviso se va.
      await hasta(function () { return window.__enVuelo === 0; }, 5000);
      window.__v = 3;
      var k3 = kpis();
      var b = document.getElementById('btn-actualizar');
      b.click(); b.click();
      var deshabilitado = b.disabled;
      await hasta(function () { return /30\/10\/2026 · 11:40/.test(texto()); }, 1200);
      apunta('A8', [/30\/10\/2026 · 11:40/.test(texto()), /No se pudo actualizar/.test(texto()), kpis() - k3, deshabilitado]);
      // A9 en Backlog el SLA ya no se pide.
      activarTab('backlog');
      await hasta(function () { return !!document.querySelector('#estado-carga-bl .datos-info-linea'); }, 6000);
      var k4 = kpis();
      await espera(3500);
      apunta('A9', [kpis() - k4, (window.__pedidas['backlog_resumen.ashx'] || 0) >= 2]);
    } catch (e) { errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R });
    document.body.appendChild(pre);
  })();
}

function sondaBacklog() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn, tope) { for (var t = 0; !fn() && t < (tope || 4000); t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  function texto() {
    return Array.prototype.map.call(document.querySelectorAll('#estado-carga-bl .datos-info-linea'), function (d) { return d.textContent; }).join(' | ');
  }
  function consultado() { var m = /Consultado: [^|]+/.exec(texto()); return m ? m[0].trim() : null; }
  function criticos() { return document.querySelector('#kpis-bl [data-indicador="criticos"]'); }
  function prioridades() {
    var s = {};
    Array.prototype.forEach.call(document.querySelectorAll('#tabla-antiguos-bl tbody tr'), function (tr) {
      var td = tr.querySelectorAll('td')[3]; if (td) s[td.textContent] = 1;
    });
    return Object.keys(s);
  }
  (async function () {
    try {
      await hasta(function () { return criticos() && /29\/10\/2026/.test(texto()); });
      criticos().click(); await espera(80);
      var b = document.getElementById('btn-actualizar-bl');
      var r0 = window.__pedidas['backlog_resumen.ashx'];
      window.__v = 2;
      b.click(); b.click();
      apunta('B2a', b.disabled);
      await hasta(function () { return /30\/10\/2026/.test(texto()); });
      await espera(80);
      apunta('B1', [/30\/10\/2026/.test(texto()), !!consultado(), criticos().getAttribute('aria-pressed'), prioridades()]);
      apunta('B2', [window.__pedidas['backlog_resumen.ashx'] - r0, b.disabled]);
      var antes = consultado();
      window.__falla = true;
      b.click();
      await hasta(function () { return /No se pudo actualizar/.test(texto()); });
      apunta('B3', [/No se pudo actualizar/.test(texto()), /30\/10\/2026/.test(texto()), consultado() === antes,
                    criticos().getAttribute('aria-pressed'), prioridades()]);
      window.__falla = false;
      await hasta(function () { return !b.disabled; });
      b.click();
      await hasta(function () { return !/No se pudo actualizar/.test(texto()); });
      apunta('B4', [/No se pudo actualizar/.test(texto()), !!consultado()]);
    } catch (e) { errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R });
    document.body.appendChild(pre);
  })();
}

var DASH = Banco.pagina('dashboard.html', 'dashboard.js', envoltura(1500), sondaDashboard);
var BL = Banco.pagina('backlog/backlog.html', 'backlog.js', envoltura(0), sondaBacklog);
Banco.correr({ '/__banco_dash.html': DASH, '/backlog/__banco.html': BL }, ['/__banco_dash.html#sla', '/backlog/__banco.html'], 60000)
  .then(function (res) {
    if (!res[0]) { console.log('FAIL  Chrome no devolvio el resultado de la sonda del tablero'); fallos++; }
    else {
      Check('A0 tablero sin errores de JS', [], res[0].errores);
      var a = Banco.mapa(res[0]);
      Check('A1 arranque: sello del origen y "Consultado" aparte', [true, true], a.A1);
      Check('A2 al cumplirse el intervalo: UNA peticion y el sello nuevo', [1, true, true], a.A2);
      Check('A3 pagina oculta: no pide', 0, a.A3);
      Check('A4 al volver a visible: una sola vez', 1, a.A4);
      Check('A5 con una fecha con el foco: no pide', [true, 0], a.A5);
      Check('A6 respuesta lenta: nunca dos a la vez', 1, a.A6);
      Check('A7 fallo: aviso, "Consultado" igual, sello y KPIs de antes', [true, true, true, true], a.A7);
      Check('A8 Actualizar (dos clics): sello nuevo ya, sin aviso, UNA peticion; el boton se deshabilita mientras pide', [true, false, 1, true], a.A8);
      Check('A9 en Backlog: SLA no se pide; Backlog si se monto', [0, true], a.A9);
    }
    if (!res[1]) { console.log('FAIL  Chrome no devolvio el resultado de la sonda de Backlog'); fallos++; }
    else {
      Check('B0 Backlog sin errores de JS', [], res[1].errores);
      var o = Banco.mapa(res[1]);
      Check('B2a el boton se deshabilita mientras pide', true, o.B2a);
      Check('B1 Actualizar: sello nuevo, "Consultado", Criticos sigue elegida y la tabla filtrada', [true, true, 'true', ['Critica']], o.B1);
      Check('B2 dos clics seguidos: una sola peticion; boton otra vez habilitado', [1, false], o.B2);
      Check('B3 fallo: aviso; sello, "Consultado", seleccion y filas de antes', [true, true, true, 'true', ['Critica']], o.B3);
      Check('B4 la siguiente buena quita el aviso', [false, true], o.B4);
    }
    console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
    process.exit(fallos === 0 ? 0 : 1);
  });
