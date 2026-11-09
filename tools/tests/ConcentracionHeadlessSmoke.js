// tools/tests/ConcentracionHeadlessSmoke.js - pestaña "Vista general de
// servicios" en un Chrome de verdad (tools/tests/BancoHeadless.js; no escribe
// en disco). Un fetch de mentira hace de handlers/concentracion.ashx: lee los
// filtros del query string (modo, slot, mes, so, grupo), responde con el
// contrato del handler, cuenta las peticiones y puede fallar entero
// (__falla), devolver un periodo vacio (__vacio) o una cobertura (__cobertura).
//
//   C  concentracion/concentracion.html (pagina suelta)
//      C1  carga sola, sin elegir servicio: UNA peticion modo=slot&slot=0,
//          las tres graficas, "Periodo: Slot 0 · del ... al ..." y ningun
//          analisis.ashx.
//      C2  Pareto: Top 10 de 12, azul acero hasta el 80 % (la que cruza
//          incluida), azul claro despues, linea ambar = acumulado del
//          servidor, referencia en 80.
//      C3  categorias: Top 15 de 20, eje abreviado en dos lineas, tooltip con
//          la ruta completa, alto del lienzo por filas.
//      C4  cada grafica con SU total.
//      C5  Slot: "+" pide slot=1 (una peticion para las tres); 15 + Enter
//          acota a 12; "−" hasta 0.
//      C6  Mes: el boton Mes pide modo=mes (sin slot), oculta el Slot,
//          muestra y llena el selector de meses; elegir otro mes lo pide; el
//          texto de lo aplicado dice el mes; volver a Slot conserva el slot.
//      C7  Service Owner: elegir dos = UNA peticion con so=A|B; quedan
//          marcados tras repintar las opciones; lo aplicado lo dice.
//      C8  Grupo + SO juntos en la misma peticion; totales filtrados.
//      C9  filtros sin tickets: "Sin tickets con estos filtros." en las tres.
//      C10 "Limpiar" quita SO y Grupo (periodo igual) y vuelve a pedir.
//      C11 refresco automatico y "Actualizar" con mes + SO + Grupo: mismos
//          parametros, sin "Calculando…", selecciones intactas; un fallo deja
//          todo y avisa.
//      C12 falla la peticion: banda y las tres en error.
//      C13 cobertura parcial: aviso; completa o sin medir: nada.
//   D  dashboard.html#concentracion (MOCK_DATA para SLA)
//      D1  la entrada "Vista general de servicios" queda marcada, la pestaña
//          se monta y pide concentracion.ashx sin pasar por Analisis.
//      D2  Analisis de servicios sigue igual: al abrirla pide SOLO la lista
//          de servicios (accion=servicios) y no analiza nada.
//      D3  volver no la monta de nuevo ni repide.
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

// El "handler": el contrato de concentracion.ashx, con los filtros del URL.
function respondeConc(u, v) {
  var q = new URL(u, location.href).searchParams;
  var modo = q.get('modo') === 'mes' ? 'mes' : 'slot';
  var s = Number(q.get('slot') || 0);
  var mes = q.get('mes') || '2026-11';
  var so = (q.get('so') || '').split('|').filter(Boolean);
  var grupo = (q.get('grupo') || '').split('|').filter(Boolean);
  function filas(etq, nombres, cantidades) {
    var total = cantidades.reduce(function (a, b) { return a + b; }, 0), acum = 0;
    return cantidades.map(function (c, i) {
      acum += c;
      var f = { Posicion: i + 1, CantidadTickets: c, TotalTickets: total,
                Porcentaje: Math.round(10000 * c / total) / 100,
                PorcentajeAcumulado: i === cantidades.length - 1 ? 100 : Math.round(10000 * acum / total) / 100 };
      f[etq] = nombres(i);
      if (etq === 'Servicio') f.NombreServicio = 'Servicio ' + (i + 1) + ' ' + modo + (modo === 'mes' ? ' ' + mes : ' ' + s);
      return f;
    });
  }
  var meses = [];
  for (var m = 0; m <= 12; m++) {
    var d = new Date(Date.UTC(2026, 10 - m, 1)), val = d.toISOString().slice(0, 7);
    meses.push({ valor: val, etiqueta: 'Mes ' + val, enCurso: m === 0 });
  }
  var desde, hasta;
  if (modo === 'mes') { desde = mes + '-01'; hasta = mes === '2026-11' ? '2026-11-09' : mes + '-28'; }
  else {
    var h = new Date(Date.UTC(2026, 10, 9) - s * 30 * 864e5);
    hasta = h.toISOString().slice(0, 10); desde = new Date(h.getTime() - 29 * 864e5).toISOString().slice(0, 10);
  }
  var filtrando = so.length || grupo.length;
  var nadie = so.indexOf('Nadie') >= 0;
  var vacio = window.__vacio || nadie;
  var cp = filtrando ? [20, 10] : [120 + (v - 1), 90, 70, 55, 45, 35, 30, 20, 15, 10, 6, 4 - (v - 1)];
  var cc = filtrando ? [18, 10] : [60, 50, 45, 40, 35, 30, 28, 26, 24, 22, 20, 18, 16, 14, 12, 10, 10, 8, 6, 6];
  var cg = filtrando ? (grupo.length ? grupo.map(function () { return 15; }) : [20, 8]) : [90, 70, 60, 45, 40, 30, 25, 20, 18, 16, 14, 12, 10, 8, 4, 4, 2, 2];
  var opSo = [{ valor: 'Ana', tickets: 300 }, { valor: 'Beto', tickets: 150 }, { valor: '(Sin Service Owner)', tickets: 50 },
              { valor: 'Nadie', tickets: 1 }];   // su unico ticket no pasa ningun otro filtro
  so.forEach(function (x) { if (!opSo.some(function (o) { return o.valor === x; })) opSo.push({ valor: x, tickets: 0 }); });
  var opGr = []; for (var g = 1; g <= 18; g++) opGr.push({ valor: 'Grupo ' + g, tickets: 40 - g });
  var periodo = window.__vacio ? 0 : 500;
  return {
    modo: modo, slot: modo === 'slot' ? s : null, mes: modo === 'mes' ? mes : null, slotMaximo: 12, meses: meses,
    periodo: { desde: desde, hasta: hasta, dias: 30 },
    filtros: { serviceOwners: so, grupos: grupo },
    opciones: { serviceOwners: opSo, grupos: opGr },
    ticketsPeriodo: periodo, ticketsFiltrados: vacio ? 0 : (filtrando ? 30 : periodo),
    cobertura: window.__cobertura !== undefined ? window.__cobertura
      : { diasConTickets: 29, diasEsperados: 29, primerDia: null, ultimoDia: null, completa: true, excluyeHoy: true },
    pareto: vacio ? [] : filas('Servicio', function (i) { return 'S' + (i + 1); }, cp),
    categorias: vacio ? [] : filas('Categoria', function (i) {
      return '/S-Servicio largo ' + i + '/Nivel intermedio con nombre largo ' + i + '/Detalle final de la categoria numero ' + i; }, cc),
    grupos: vacio ? [] : filas('Grupo', function (i) { return grupo[i] || ('Grupo ' + (i + 1)); }, cg),
    errores: {}, avisos: [],
    dataInfo: { ultimaActualizacion: SELLO[v], periodoInicio: desde, periodoFin: hasta, tipoPeriodo: 'rango' },
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
  'function qs(u) { var p = new URL(u, location.href).searchParams; var o = {}; p.forEach(function (v, k) { o[k] = v; }); return o; }\n' +
  'function pedidasConc() { return __urls.filter(function (u) { return u.indexOf("concentracion.ashx") >= 0; }).map(qs); }\n' +
  'function ultimaConc() { var l = pedidasConc(); return l[l.length - 1]; }\n' +
  'function slots() { return pedidasConc().map(function (o) { return o.slot; }); }\n' +
  'function marcados(id) { return Array.prototype.map.call($c(id).selectedOptions, function (o) { return o.value; }); }\n' +
  'function elegir(id, valores) { Array.prototype.forEach.call($c(id).options, function (o) { o.selected = valores.indexOf(o.value) >= 0; });\n' +
  '  $c(id).dispatchEvent(new Event("change", { bubbles: true })); }\n' +
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
  'apunta("C1", [pedidasConc(), !!graf("pareto"), !!graf("categorias"), !!graf("grupos"), $c("activos").textContent,\n' +
  '  __pedidas["an-servicios"] || 0, __pedidas["an-otro"] || 0, $c("campo-slot").hidden, $c("campo-mes").hidden]);\n' +
  // C2
  'var p = graf("pareto");\n' +
  'apunta("C2", [p.data.labels.length, p.data.datasets[0].backgroundColor, p.data.datasets[1].type, p.data.datasets[1].borderColor,\n' +
  '  p.data.datasets[1].data.slice(0, 3), p.data.datasets[2].data.every(function (x) { return x === 80; }), p.data.datasets[2].borderColor]);\n' +
  // C3
  'var c = graf("categorias");\n' +
  'apunta("C3", [c.data.labels.length, c.data.labels[0], c.options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]), c.options.indexAxis,\n' +
  '  $c("lienzo-categorias").style.height]);\n' +
  // C4
  'apunta("C4", [hint("pareto"), hint("categorias"), hint("grupos")]);\n' +
  // C5
  'var n0 = __urls.length;\n' +
  '$c("slot-mas").click();\n' +
  'await hasta(function () { return /slot 1$/.test(graf("pareto") ? graf("pareto").options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]) : ""); });\n' +
  'var tras = __urls.slice(n0).map(function (u) { return qs(u).slot; });\n' +
  'var campo = $c("slot-n"); campo.value = "15"; campo.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));\n' +
  'await hasta(function () { return slots().slice(-1)[0] === "12"; }); await espera(120);\n' +
  'var en12 = [campo.value, $c("slot-mas").disabled];\n' +
  'for (var i = 0; i < 12; i++) { $c("slot-menos").click(); }\n' +
  'await hasta(function () { return slots().slice(-1)[0] === "0" && $c("slot-menos").disabled; }); await espera(120);\n' +
  'apunta("C5", [tras, en12, campo.value, $c("slot-menos").disabled, /^Periodo: Slot 0 /.test($c("activos").textContent)]);\n' +
  // C6 Mes
  'var n6 = pedidasConc().length;\n' +
  'document.querySelector("#conc-filtros [data-modo=mes]").click();\n' +
  'await hasta(function () { return /Mes Mes 2026-11/.test($c("activos").textContent); });\n' +
  'var pmes = pedidasConc().slice(n6);\n' +
  'var vis = [$c("campo-slot").hidden, $c("campo-mes").hidden, $c("mes").options.length, $c("mes").value];\n' +
  'var sel = $c("mes"); sel.value = "2026-09"; sel.dispatchEvent(new Event("change", { bubbles: true }));\n' +
  'await hasta(function () { return /Mes Mes 2026-09/.test($c("activos").textContent); });\n' +
  'var tras6 = ultimaConc();\n' +
  'document.querySelector("#conc-filtros [data-modo=slot]").click();\n' +
  'await hasta(function () { return /^Periodo: Slot 0/.test($c("activos").textContent); });\n' +
  'apunta("C6", [pmes, vis, tras6, ultimaConc(), document.querySelector("[data-modo=mes]").getAttribute("aria-pressed")]);\n' +
  // C7 SO
  'var n7 = pedidasConc().length;\n' +
  'elegir("f-so", ["Ana"]); elegir("f-so", ["Ana", "(Sin Service Owner)"]);\n' +
  'await hasta(function () { return pedidasConc().length > n7 && !msg("pareto"); }); await espera(150);\n' +
  'apunta("C7", [pedidasConc().length - n7, ultimaConc().so, marcados("f-so"), /Service Owner: Ana, \\(Sin Service Owner\\)/.test($c("activos").textContent),\n' +
  '  /30 de 500 tickets del periodo/.test($c("activos").textContent)]);\n' +
  // C8 Grupo + SO
  'elegir("f-grupo", ["Grupo 3"]);\n' +
  'await hasta(function () { return ultimaConc().grupo === "Grupo 3" && !msg("pareto"); }); await espera(150);\n' +
  'apunta("C8", [ultimaConc(), hint("pareto"), hint("grupos"), marcados("f-grupo"), marcados("f-so")]);\n' +
  // C9 sin tickets por filtros
  'elegir("f-so", ["Nadie"]);\n' +
  'await hasta(function () { return msg("pareto") === "Sin tickets con estos filtros."; });\n' +
  'apunta("C9", [msg("pareto"), msg("categorias"), msg("grupos"), marcados("f-so")]);\n' +
  // C10 Limpiar
  '$c("btn-limpiar").click();\n' +
  'await hasta(function () { var u = ultimaConc(); return !u.so && !u.grupo && !msg("pareto"); }); await espera(100);\n' +
  'apunta("C10", [ultimaConc(), marcados("f-so"), marcados("f-grupo"), /Service Owner: todos · Grupo: todos/.test($c("activos").textContent)]);\n' +
  // C11 refresco con mes + SO + grupo
  'document.querySelector("#conc-filtros [data-modo=mes]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "mes" && !msg("pareto"); });\n' +
  'sel.value = "2026-08"; sel.dispatchEvent(new Event("change", { bubbles: true }));\n' +
  'await hasta(function () { return ultimaConc().mes === "2026-08" && !msg("pareto"); });\n' +
  'elegir("f-so", ["Beto"]); await hasta(function () { return ultimaConc().so === "Beto" && !msg("pareto"); });\n' +
  'elegir("f-grupo", ["Grupo 5", "Grupo 7"]); await hasta(function () { return ultimaConc().grupo === "Grupo 5|Grupo 7" && !msg("pareto"); });\n' +
  'await espera(100);\n' +
  'var n11 = pedidasConc().length; window.__v = 2; window.__lento = 300;\n' +
  'var r11 = M().refrescar(); await espera(150);\n' +
  'var durante = [msg("pareto"), !!graf("pareto")];\n' +
  'await r11; window.__lento = 0; await espera(50);\n' +
  'var tras11 = pedidasConc().slice(n11);\n' +
  'var estado11 = [marcados("f-so"), marcados("f-grupo"), $c("mes").value, M().filtros().modo];\n' +
  'var n11b = pedidasConc().length; $c("btn-actualizar").click();\n' +
  'await hasta(function () { return pedidasConc().length > n11b && !$c("btn-actualizar").disabled; });\n' +
  'var actualizar = pedidasConc().slice(n11b);\n' +
  'window.__falla = true; await M().refrescar(); window.__falla = false;\n' +
  'apunta("C11", [tras11, durante, estado11, actualizar, !!graf("pareto"), $c("error").hidden,\n' +
  '  lineas().some(function (l) { return /No se pudo actualizar/.test(l); }), marcados("f-so"), marcados("f-grupo")]);\n' +
  // C12 falla entera
  'window.__falla = true; await M().recargar(); window.__falla = false;\n' +
  'apunta("C12", [$c("error").hidden, $c("error-msg").textContent, [msg("pareto"), msg("categorias"), msg("grupos")]]);\n' +
  // C13 cobertura
  'await M().recargar(); var completa = $c("cobertura").hidden;\n' +
  'window.__cobertura = { diasConTickets: 16, diasEsperados: 30, primerDia: "2025-11-19", ultimoDia: "2025-12-14", completa: false, excluyeHoy: false };\n' +
  'await M().recargar(); var parcial = [$c("cobertura").hidden, $c("cobertura").textContent];\n' +
  'window.__cobertura = null; await M().recargar(); var nula = $c("cobertura").hidden; window.__cobertura = undefined;\n' +
  'apunta("C13", [completa, parcial, nula]);\n');

var sondaD = conComun(
  'await hasta(function () { return !!document.getElementById("conc-chart-pareto") && window.TableroConcentracionModulo && Chart.getChart(document.getElementById("conc-chart-pareto")); }, 8000);\n' +
  'var b = document.getElementById("mtab-concentracion");\n' +
  'apunta("D1", [b.querySelector(".mnav-txt").textContent, b.getAttribute("title"), b.classList.contains("active"), b.getAttribute("aria-current"),\n' +
  '  document.getElementById("tab-concentracion").classList.contains("active"), slots(), __pedidas["an-servicios"] || 0,\n' +
  '  __pedidas["an-otro"] || 0, document.getElementById("tab-analisis").childElementCount,\n' +
  '  document.querySelector("#tab-concentracion h1").textContent]);\n' +
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

Banco.correr(paginas, urls, 90000).then(function (res) {
  function seccion(i, nombre, fn) {
    if (!res[i]) { console.log('FAIL  ' + nombre + ': Chrome no devolvio el resultado de la sonda'); fallos++; return; }
    Check(nombre + ' sin errores de JS', [], res[i].errores);
    fn(Banco.mapa(res[i]));
  }
  var AZUL = '#5b84b1', CLARO = '#c3d5ea';
  seccion(0, 'C', function (o) {
    Check('C1 carga sola con modo=slot&slot=0, tres graficas, periodo del servidor, sin Analisis, control de Slot visible',
      [[{ modo: 'slot', slot: '0' }], true, true, true,
       'Periodo: Slot 0 · del 11/10/2026 al 09/11/2026 · Service Owner: todos · Grupo: todos · 500 tickets en el periodo', 0, 0, false, true], o.C1);
    // Acumulado 24, 42, 56, 67, 76, 83 -> 6 dentro.
    Check('C2 Pareto: Top 10 de 12, azul hasta el 80 % (la que cruza incluida), azul claro despues, linea ambar, referencia gris en 80',
      [10, [AZUL, AZUL, AZUL, AZUL, AZUL, AZUL, CLARO, CLARO, CLARO, CLARO], 'line', '#d39a3a', [24, 42, 56], true, '#8a94a6'], o.C2);
    Check('C3 categorias: Top 15, eje en dos lineas, tooltip con la ruta completa, alto por filas',
      [15, ['Nivel intermedio con', 'nombre largo 0 › Detal…'],
       '/S-Servicio largo 0/Nivel intermedio con nombre largo 0/Detalle final de la categoria numero 0', 'y', '610px'], o.C3);
    Check('C4 cada grafica con su total',
      ['Top 10 de 12 servicios · 500 tickets · referencia 80 %', 'Top 15 de 20 categorías · 480 tickets',
       'Top 15 de 18 grupos · 470 tickets'], o.C4);
    Check('C5 Slot: + pide slot=1 (una peticion); 15 se acota a 12; "−" hasta 0',
      [['1'], ['12', true], '0', true, true], o.C5);
    Check('C6 Mes: pide modo=mes sin slot; oculta Slot y llena 13 meses; elegir otro lo pide; volver a Slot conserva el 0',
      [[{ modo: 'mes' }], [true, false, 13, '2026-11'], { modo: 'mes', mes: '2026-09' }, { modo: 'slot', slot: '0' }, 'false'], o.C6);
    Check('C7 SO: dos cambios seguidos = UNA peticion so=Ana|(Sin Service Owner); siguen marcados; lo aplicado lo dice',
      [1, 'Ana|(Sin Service Owner)', ['Ana', '(Sin Service Owner)'], true, true], o.C7);
    Check('C8 Grupo + SO en la misma peticion; graficas con lo filtrado',
      [{ modo: 'slot', slot: '0', so: 'Ana|(Sin Service Owner)', grupo: 'Grupo 3' }, '2 servicios · 30 tickets · referencia 80 %',
       '1 grupos · 15 tickets', ['Grupo 3'], ['Ana', '(Sin Service Owner)']], o.C8);
    Check('C9 filtros sin tickets: mensaje en las tres; el filtro se queda (opcion con 0)',
      ['Sin tickets con estos filtros.', 'Sin tickets con estos filtros.', 'Sin tickets con estos filtros.', ['Nadie']], o.C9);
    Check('C10 Limpiar quita SO y Grupo, el periodo se queda',
      [{ modo: 'slot', slot: '0' }, [], [], true], o.C10);
    Check('C11 refresco y Actualizar con mes + SO + Grupo: mismos parametros, sin "Calculando…", selecciones intactas; fallo avisa',
      [[{ modo: 'mes', mes: '2026-08', so: 'Beto', grupo: 'Grupo 5|Grupo 7' }], [null, true],
       [['Beto'], ['Grupo 5', 'Grupo 7'], '2026-08', 'mes'],
       [{ modo: 'mes', mes: '2026-08', so: 'Beto', grupo: 'Grupo 5|Grupo 7' }], true, true, true, ['Beto'], ['Grupo 5', 'Grupo 7']], o.C11);
    Check('C12 falla la peticion: banda y las tres en error',
      [false, 'caido', ['Error al cargar datos.', 'Error al cargar datos.', 'Error al cargar datos.']], o.C12);
    Check('C13 cobertura: completa sin aviso; parcial con el hecho; sin medir sin aviso',
      [true, [false, 'Cobertura parcial: hay tickets en 16 de 30 días del periodo · datos del 19/11/2025 al 14/12/2025.'], true], o.C13);
  });
  seccion(1, 'D', function (o) {
    Check('D1 #concentracion: "Vista general de servicios" marcada, montada, pide slot 0, Analisis sin tocar',
      ['Vista general de servicios', 'Vista general de servicios', true, 'page', true, ['0'], 0, 0, 0,
       'Tickets Proactivanet — Vista general de servicios'], o.D1);
    Check('D2 Analisis igual que siempre: solo la lista de servicios, nada analizado', [1, 0, 'page', false], o.D2);
    Check('D3 volver: sin montar de nuevo ni repedir', [0, 1, true], o.D3);
  });
  console.log(fallos ? fallos + ' FALLARON' : 'TODO PASA');
  process.exit(fallos ? 1 : 0);
});
