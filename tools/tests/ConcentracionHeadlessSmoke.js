// tools/tests/ConcentracionHeadlessSmoke.js - pestaña "Concentracion de
// tickets" en un Chrome de verdad (tools/tests/BancoHeadless.js; no escribe en
// disco). Un fetch de mentira hace de handlers/concentracion.ashx: arma las
// filas por Slot, cuenta las peticiones y puede fallar entero (__falla), dejar
// sin datos una grafica (__errGrupos) o devolver un Slot vacio (__vacio).
//
//   C  concentracion/concentracion.html (pagina suelta)
//      C1 carga sola, sin elegir servicio: UNA peticion con slot=0, las tres
//         graficas, el periodo que manda el servidor y ningun analisis.ashx.
//      C2 Pareto: Top 10 de 12, barras verdes (oscuro hasta el 80 %, claro
//         despues), linea amarilla = acumulado del SP, referencia en 80.
//      C3 categorias: Top 15 de 20, eje con la ruta abreviada en dos lineas, tooltip con la
//         ruta completa, alto del lienzo por filas.
//      C4 cada grafica con SU total (Pareto 500, categorias 480, grupos 470).
//      C5 Slot: "+" pide slot=1 (una peticion para las tres) y pinta el
//         periodo nuevo; escribir 15 + Enter acota a 12 y deshabilita "+";
//         "−" hasta 0 lo deshabilita.
//      C6 falla solo grupos: su tarjeta dice el error, las otras dos pintan.
//      C7 falla la peticion: banda de error y las tres en error.
//      C8 refresco: mismo Slot, sin "Calculando…", dato nuevo; un fallo deja
//         los datos y avisa en la pastilla.
//      C9 "Actualizar" pide ya.
//      C10 Slot sin tickets: "Sin tickets en este Slot." en las tres.
//   D  dashboard.html#concentracion (MOCK_DATA para SLA)
//      D1 la entrada de la barra queda marcada y la pestaña se monta y pide
//         concentracion.ashx sin pasar por Analisis (0 analisis.ashx, su
//         contenedor vacio).
//      D2 Analisis de servicios sigue igual: al abrirla pide SOLO la lista de
//         servicios (accion=servicios) y no analiza nada hasta elegir uno.
//      D3 volver a Concentracion no la monta de nuevo ni repide.
//
//   node tools\tests\ConcentracionHeadlessSmoke.js   # sale 0 si todo paso
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

var SELLO = { 1: '2026-11-09T08:00:00', 2: '2026-11-09T09:15:00' };

// El "handler": filas como las del SP (Posicion, acumulado sobre TODAS).
function respondeConc(u, v) {
  var q = new URL(u, location.href).searchParams;
  var s = Number(q.get('slot'));
  function filas(etq, nombres, cantidades) {
    var total = cantidades.reduce(function (a, b) { return a + b; }, 0), acum = 0;
    return cantidades.map(function (c, i) {
      acum += c;
      var f = { Posicion: i + 1, CantidadTickets: c, TotalTickets: total,
                Porcentaje: Math.round(10000 * c / total) / 100,
                PorcentajeAcumulado: i === cantidades.length - 1 ? 100 : Math.round(10000 * acum / total) / 100 };
      f[etq] = nombres(i);
      return f;
    });
  }
  // Pareto: 12 servicios, 500 tickets (+ v-1 en la primera barra para ver el refresco).
  var cp = [120 + (v - 1), 90, 70, 55, 45, 35, 30, 20, 15, 10, 6, 4 - (v - 1)];
  // Categorias: 20 rutas, 480 tickets. Grupos: 18, 470 tickets.
  var cc = [60, 50, 45, 40, 35, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 10, 8, 6, 6];
  var cg = [90, 70, 60, 45, 40, 30, 25, 20, 18, 16, 14, 12, 10, 8, 4, 4, 2, 2];
  var hasta = new Date(Date.UTC(2026, 10, 9) - s * 30 * 864e5), desde = new Date(hasta.getTime() - 29 * 864e5);
  var vacio = window.__vacio;
  return {
    slot: s, slotMaximo: 12,
    periodo: { desde: desde.toISOString().slice(0, 10), hasta: hasta.toISOString().slice(0, 10), dias: 30 },
    pareto: vacio ? [] : filas('Servicio', function (i) { return 'Servicio ' + (i + 1) + ' slot ' + s; }, cp),
    categorias: vacio ? [] : filas('Categoria', function (i) {
      return '/S-Servicio largo ' + i + '/Nivel intermedio con nombre largo ' + i + '/Detalle final de la categoria numero ' + i; }, cc),
    grupos: vacio ? [] : (window.__errGrupos ? null : filas('Grupo', function (i) { return 'Grupo ' + (i + 1); }, cg)),
    errores: window.__errGrupos ? { grupos: 'El sitio no puede ejecutar dbo.usp_CorreoServicio_TicketsGrupo (error 2812): falta el procedimiento o el permiso EXECUTE.' } : {},
    avisos: [],
    dataInfo: { ultimaActualizacion: SELLO[v], periodoInicio: desde.toISOString().slice(0, 10),
                periodoFin: hasta.toISOString().slice(0, 10), tipoPeriodo: 'rango' },
  };
}
function claveConc(u) {
  if (u.indexOf('concentracion.ashx') >= 0) return 'conc';
  if (u.indexOf('analisis.ashx') >= 0) return /accion=servicios/.test(u) ? 'an-servicios' : 'an-otro';
  return null;
}
function respondeDash(u, v) {
  if (u.indexOf('analisis.ashx') >= 0) return { servicios: [{ Servicio: 'bio', Nombre: 'S-Biometrico', Reglas: 1, Criterios: 1 }] };
  return respondeConc(u, v);
}

function stub(responde, clave) {
  return '<script>\n' +
    'var SELLO = ' + JSON.stringify(SELLO) + ';\n' +
    'window.__v = 1; window.__falla = false; window.__lento = 0; window.__pedidas = {}; window.__urls = [];\n' +
    'window.__fetchOriginal = window.fetch;\n' +
    'var __responde = ' + responde.toString() + ';\n' +
    (responde === respondeDash ? 'var respondeConc = ' + respondeConc.toString() + ';\n' : '') +
    'var __clave = ' + clave.toString() + ';\n' +
    'window.fetch = function (u) { u = String(u); var k = __clave(u);\n' +
    '  if (k === null) return window.__fetchOriginal.apply(window, arguments);\n' +
    '  window.__urls.push(u); window.__pedidas[k] = (window.__pedidas[k] || 0) + 1;\n' +
    '  var v = window.__v, falla = window.__falla;\n' +
    '  return new Promise(function (ok) { setTimeout(ok, 20 + window.__lento); })\n' +
    '    .then(function () { return falla ? { error: "caido" } : __responde(u, v); })\n' +
    '    .then(function (j) { var bien = !falla;\n' +
    '      return { ok: bien, status: bien ? 200 : 500,\n' +
    '        json: function () { return Promise.resolve(JSON.parse(JSON.stringify(j))); },\n' +
    '        text: function () { return Promise.resolve(JSON.stringify(j)); } }; }); };\n' +
    '</script>\n';
}

var COMUN = 'var R = [], errores = [];\n' +
  'window.addEventListener("error", function (e) { errores.push(String(e.message)); });\n' +
  'function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }\n' +
  'async function hasta(fn, tope) { for (var t = 0; !fn() && t < (tope || 4000); t += 25) await espera(25); return fn(); }\n' +
  'function apunta(caso, v) { R.push([caso, v]); }\n' +
  'function $c(id) { return document.getElementById("conc-" + id); }\n' +
  'function graf(k) { return Chart.getChart($c("chart-" + k)) || null; }\n' +
  'function msg(k) { var m = $c("msg-" + k); return m.hidden ? null : m.textContent; }\n' +
  'function hint(k) { return $c("hint-" + k).textContent; }\n' +
  'function slots() { return __urls.filter(function (u) { return u.indexOf("concentracion.ashx") >= 0; })\n' +
  '  .map(function (u) { return new URL(u, location.href).searchParams.get("slot"); }); }\n' +
  'function lineas() { return Array.prototype.map.call(document.querySelectorAll("#conc-estado .datos-info-linea"), function (d) { return d.textContent; }); }\n' +
  'function cerrar() { var pre = document.createElement("pre"); pre.id = "__res";\n' +
  '  pre.textContent = JSON.stringify({ errores: errores, r: R }); document.body.appendChild(pre); }\n';

function conComun(cuerpo) {
  return new Function(COMUN + '(async function () { try {\n' + cuerpo + '\n} catch (e) { errores.push("sonda: " + e.message + " " + e.stack); } cerrar(); })();');
}

var sondaC = conComun(
  'var M = function () { return window.TableroConcentracionModulo; };\n' +
  'await hasta(function () { return graf("pareto") && graf("categorias") && graf("grupos") && M(); });\n' +
  // C1
  'apunta("C1", [slots(), !!graf("pareto"), !!graf("categorias"), !!graf("grupos"), $c("periodo").textContent,\n' +
  '  __pedidas["an-servicios"] || 0, __pedidas["an-otro"] || 0, $c("slot-n").value]);\n' +
  // C2
  'var p = graf("pareto");\n' +
  'apunta("C2", [p.data.labels.length, p.data.datasets[0].backgroundColor, p.data.datasets[1].type, p.data.datasets[1].borderColor,\n' +
  '  p.data.datasets[1].data.slice(0, 3), p.data.datasets[2].data.every(function (x) { return x === 80; })]);\n' +
  // C3
  'var c = graf("categorias");\n' +
  'var titulo = c.options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]);\n' +
  'apunta("C3", [c.data.labels.length, c.data.labels[0], titulo, c.options.indexAxis, $c("lienzo-categorias").style.height,\n' +
  '  c.data.labels.every(function (l) { return [].concat(l).length <= 2 && [].concat(l).every(function (x) { return x.length <= 26; }); })]);\n' +
  // C4
  'apunta("C4", [hint("pareto"), hint("categorias"), hint("grupos")]);\n' +
  // C5
  'var n0 = __urls.length;\n' +
  '$c("slot-mas").click();\n' +
  'await hasta(function () { return /slot 1$/.test(String(graf("pareto") && graf("pareto").options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]))); });\n' +
  'var tras = __urls.slice(n0).map(function (u) { return new URL(u, location.href).searchParams.get("slot"); });\n' +
  'var per1 = $c("periodo").textContent, menos1 = $c("slot-menos").disabled;\n' +
  'var campo = $c("slot-n"); campo.value = "15"; campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));\n' +
  'await hasta(function () { return slots().slice(-1)[0] === "12" && !!graf("pareto"); });\n' +
  'await espera(80);\n' +
  'var en12 = [campo.value, $c("slot-mas").disabled, $c("periodo").textContent];\n' +
  'for (var i = 0; i < 12; i++) { $c("slot-menos").click(); }\n' +
  'await hasta(function () { return slots().slice(-1)[0] === "0" && $c("slot-menos").disabled; });\n' +
  'await espera(100);\n' +
  'apunta("C5", [tras, per1, menos1, en12, campo.value, $c("slot-menos").disabled, M().slot()]);\n' +
  // C6 falla solo grupos
  'await hasta(function () { return !!graf("pareto") && msg("pareto") === null; });\n' +
  'window.__errGrupos = true; await M().recargar(); window.__errGrupos = false;\n' +
  'apunta("C6", [!!graf("pareto"), !!graf("categorias"), !!graf("grupos"), /2812/.test(msg("grupos") || ""),\n' +
  '  $c("msg-grupos").classList.contains("conc-msg-error"), msg("pareto"), $c("error").hidden]);\n' +
  // C7 falla todo
  'window.__falla = true; await M().recargar(); window.__falla = false;\n' +
  'apunta("C7", [$c("error").hidden, $c("error-msg").textContent, [msg("pareto"), msg("categorias"), msg("grupos")]]);\n' +
  // C8 refresco
  'await M().recargar();\n' +
  'var n8 = __pedidas.conc; window.__v = 2; window.__lento = 300;\n' +
  'var r8 = M().refrescar(); await espera(150);\n' +
  'var durante = [msg("pareto"), !!graf("pareto")];\n' +
  'await r8; window.__lento = 0;\n' +
  'var dato = graf("pareto").data.datasets[0].data[0], tras8 = __pedidas.conc - n8;\n' +
  'window.__falla = true; await M().refrescar(); window.__falla = false;\n' +
  'apunta("C8", [tras8, durante, dato, slots().slice(-1)[0], !!graf("pareto"), $c("error").hidden,\n' +
  '  lineas().some(function (l) { return /No se pudo actualizar/.test(l); })]);\n' +
  // C9 Actualizar
  'var n9 = __pedidas.conc; $c("btn-actualizar").click();\n' +
  'await hasta(function () { return __pedidas.conc > n9 && !$c("btn-actualizar").disabled; });\n' +
  'apunta("C9", [__pedidas.conc - n9, lineas().some(function (l) { return /No se pudo actualizar/.test(l); })]);\n' +
  // C10 vacio
  'window.__vacio = true; await M().recargar(); window.__vacio = false;\n' +
  'apunta("C10", [msg("pareto"), msg("categorias"), msg("grupos"), hint("pareto")]);\n');

var sondaD = conComun(
  'await hasta(function () { return !!document.getElementById("conc-chart-pareto") && window.TableroConcentracionModulo && Chart.getChart(document.getElementById("conc-chart-pareto")); }, 8000);\n' +
  'var b = document.getElementById("mtab-concentracion");\n' +
  'apunta("D1", [b.classList.contains("active"), b.getAttribute("aria-current"), document.getElementById("tab-concentracion").classList.contains("active"),\n' +
  '  slots(), __pedidas["an-servicios"] || 0, __pedidas["an-otro"] || 0, document.getElementById("tab-analisis").childElementCount]);\n' +
  'activarTab("analisis");\n' +
  'await hasta(function () { return (__pedidas["an-servicios"] || 0) >= 1 && document.querySelector("#tab-analisis select"); }, 8000);\n' +
  'await espera(300);\n' +
  'apunta("D2", [__pedidas["an-servicios"], __pedidas["an-otro"] || 0, document.getElementById("mtab-analisis").getAttribute("aria-current"),\n' +
  '  document.getElementById("tab-concentracion").classList.contains("active")]);\n' +
  'var c0 = __pedidas.conc;\n' +
  'activarTab("concentracion"); await espera(300);\n' +
  'apunta("D3", [__pedidas.conc - c0, document.querySelectorAll("script[src*=\\"concentracion.js\\"]").length, !!Chart.getChart(document.getElementById("conc-chart-pareto"))]);\n');

var paginas = {
  '/concentracion/__banco.html': Banco.pagina('concentracion/concentracion.html', 'concentracion.js', stub(respondeConc, claveConc), sondaC),
  '/__banco_dash.html': Banco.pagina('dashboard.html', 'dashboard.js',
    '<script>window.MockData.MOCK_DATA = true;</script>\n' + stub(respondeDash, claveConc), sondaD),
};
var urls = ['/concentracion/__banco.html', '/__banco_dash.html#concentracion'];

Banco.correr(paginas, urls, 60000).then(function (res) {
  function seccion(i, nombre, fn) {
    if (!res[i]) { console.log('FAIL  ' + nombre + ': Chrome no devolvio el resultado de la sonda'); fallos++; return; }
    Check(nombre + ' sin errores de JS', [], res[i].errores);
    fn(Banco.mapa(res[i]));
  }
  seccion(0, 'C', function (o) {
    Check('C1 carga sola con slot 0, tres graficas, periodo del servidor, sin Analisis',
      [['0'], true, true, true, 'Del 11/10/2026 al 09/11/2026', 0, 0, '0'], o.C1);
    // Acumulado 120/500=24, 210/500=42, 280/500=56, 335=67, 380=76, 415=83 -> 6 dentro.
    Check('C2 Pareto: Top 10 de 12, verde oscuro hasta el 80 % (la que cruza incluida), linea amarilla',
      [10, ['#56a333', '#56a333', '#56a333', '#56a333', '#56a333', '#56a333', '#bae065', '#bae065', '#bae065', '#bae065'],
       'line', '#eab308', [24, 42, 56], true], o.C2);
    Check('C3 categorias: Top 15, eje abreviado en dos lineas, tooltip con la ruta completa, alto por filas',
      [15, ['Nivel intermedio con', 'nombre largo 0 › Detal…'],
       '/S-Servicio largo 0/Nivel intermedio con nombre largo 0/Detalle final de la categoria numero 0', 'y', '610px', true], o.C3);
    Check('C4 cada grafica con su total',
      ['Top 10 de 12 servicios · 500 tickets · referencia 80 %', 'Top 15 de 20 categorías · 480 tickets',
       'Top 15 de 18 grupos · 470 tickets'], o.C4);
    Check('C5 Slot: + pide slot=1 (una peticion), periodo nuevo; 15 se acota a 12; "−" hasta 0',
      [['1'], 'Del 11/09/2026 al 10/10/2026', false, ['12', true, 'Del 16/10/2025 al 14/11/2025'], '0', true, 0], o.C5);
    Check('C6 falla solo grupos: las otras pintan, grupos con su error', [true, true, false, true, true, null, true], o.C6);
    Check('C7 falla la peticion: banda y las tres en error',
      [false, 'caido', ['Error al cargar datos.', 'Error al cargar datos.', 'Error al cargar datos.']], o.C7);
    Check('C8 refresco: una peticion, sin "Calculando…", dato nuevo, mismo slot; un fallo deja todo y avisa',
      [1, [null, true], 121, '0', true, true, true], o.C8);
    Check('C9 Actualizar pide ya y quita el aviso', [1, false], o.C9);
    Check('C10 slot sin tickets', ['Sin tickets en este Slot.', 'Sin tickets en este Slot.', 'Sin tickets en este Slot.', ''], o.C10);
  });
  seccion(1, 'D', function (o) {
    Check('D1 #concentracion: entrada marcada, montada, pide slot 0, Analisis sin tocar',
      [true, 'page', true, ['0'], 0, 0, 0], o.D1);
    Check('D2 Analisis igual que siempre: solo la lista de servicios, nada analizado', [1, 0, 'page', false], o.D2);
    Check('D3 volver: sin montar de nuevo ni repedir', [0, 1, true], o.D3);
  });
  console.log(fallos ? fallos + ' FALLARON' : 'TODO PASA');
  process.exit(fallos ? 1 : 0);
});
