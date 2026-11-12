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
//      C10 "Limpiar" quita SO y Grupo (el Slot igual) y vuelve a pedir.
//      C11 refresco automatico y "Actualizar" con mes + SO + Grupo: mismos
//          parametros, sin "Calculando…", selecciones intactas; un fallo deja
//          todo y avisa.
//      C12 falla la peticion: banda y las tres en error.
//      C13 cobertura parcial: aviso; completa o sin medir: nada.
//      C14 leyenda: una sola, dentro de la tarjeta del Pareto y justo debajo
//          de su lienzo, con sus cuatro rotulos y colores; con la tarjeta a
//          320 px envuelve sin salirse; ya no hay parrafo de poblacion.
//      C15 varios meses (2026-11-10): selector multiple; agregar dos
//          seguidos = UNA peticion mes=A|B|C; quitar; quitar todos = el
//          servidor da el actual; el mismo conjunto no vuelve a pedir.
//      C16 Slot acumulado: Slots 0-1, 0-2, 0-3 con sus fechas; de Mes a
//          Slot y vuelta conserva cada uno lo suyo.
//      C17 meses: espera de clics y cancelacion de la peticion reemplazada.
//      C18 (2026-11-11) "Limpiar" quita los meses: ocho elegidos en el
//          desplegable = cero marcados (<select>, desplegable y `filtros`)
//          y UNA peticion sin mes (el servidor da el actual); un mes; tras
//          abrir y cerrar; con clics pendientes de la espera = UNA; nada
//          que quitar = ninguna; el desplegable sigue sirviendo despues.
//   D  dashboard.html#concentracion (MOCK_DATA para SLA)
//      D1  la entrada de grupo "Servicios" y su boton "Vista general de
//          servicios" quedan marcados (selector visible); la pestaña se monta y pide concentracion.ashx sin pasar por Analisis.
//      D2  Analisis de servicios sigue igual: al abrirla pide SOLO la lista
//          de servicios (accion=servicios) y no analiza nada.
//      D3  volver no la monta de nuevo ni repide.
//      D4  la leyenda, embebida, igual que C14.
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
  // Varios meses por "|" (2026-11-10); sin mes = el actual. Del mas reciente.
  var mesesQ = (q.get('mes') || '').split('|').filter(Boolean);
  if (!mesesQ.length) mesesQ = ['2026-11'];
  mesesQ = mesesQ.filter(function (x, i) { return mesesQ.indexOf(x) === i; }).sort().reverse();
  var mes = mesesQ[0];
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
      if (etq === 'Servicio') f.NombreServicio = 'Servicio ' + (i + 1) + ' ' + modo + (modo === 'mes' ? ' ' + mesesQ.join('+') : ' ' + s);      return f;
    });
  }
  var meses = [];
  for (var m = 0; m <= 12; m++) {
    var d = new Date(Date.UTC(2026, 10 - m, 1)), val = d.toISOString().slice(0, 7);
    meses.push({ valor: val, etiqueta: 'Mes ' + val, enCurso: m === 0 });
  }
  var desde, hasta, rangos;
  if (modo === 'mes') {
    rangos = mesesQ.map(function (m) { return { desde: m + '-01', hasta: m === '2026-11' ? '2026-11-09' : m + '-28' }; });
    desde = rangos[rangos.length - 1].desde; hasta = rangos[0].hasta;
  } else {
    // Slot acumulado: del inicio del Slot N al fin del Slot 0 (2026-11-09).
    var h = new Date(Date.UTC(2026, 10, 9));
    hasta = h.toISOString().slice(0, 10); desde = new Date(h.getTime() - (30 * s + 29) * 864e5).toISOString().slice(0, 10);
    rangos = [{ desde: desde, hasta: hasta }];
  }
  var dias = rangos.reduce(function (a, r) { return a + Math.round((Date.parse(r.hasta) - Date.parse(r.desde)) / 864e5) + 1; }, 0);
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
    mesesElegidos: modo === 'mes' ? mesesQ : null,
    periodo: { desde: desde, hasta: hasta, dias: dias, rangos: rangos },
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
    // Como fetch de verdad, la senal (AbortController) cancela con AbortError;
    // __ignoraAbort la desoye (para probar que una respuesta vieja no pinta) y
    // __demora(u) agrega ms por URL.
    'window.__abortadas = 0; window.__ignoraAbort = false; window.__demora = null;\n' +
    'window.fetch = function (u, op) { u = String(u); var k = __clave(u);\n' +
    '  if (k === null) return window.__fetchOriginal.apply(window, arguments);\n' +
    '  window.__urls.push(u); window.__pedidas[k] = (window.__pedidas[k] || 0) + 1;\n' +
    '  var v = window.__v, falla = window.__falla, senal = op && op.signal;\n' +
    '  var demora = 20 + window.__lento + (window.__demora ? window.__demora(u) : 0);\n' +
    '  return new Promise(function (ok, mal) { var t = setTimeout(ok, demora);\n' +
    '    if (senal && !window.__ignoraAbort) senal.addEventListener("abort", function () {\n' +
    '      clearTimeout(t); window.__abortadas++; mal(new DOMException("cancelada", "AbortError")); }); })\n' +
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
  // El color que Chart.js resuelve para una barra SIN color, con la forma de
  // renderLlamadasAgente (dashboard.js): asi se ve "Atencion por agente".
  'function colorAgente() { var cv = document.createElement("canvas"); cv.width = 300; cv.height = 150; document.body.appendChild(cv);\n' +
  '  var ch = new Chart(cv, { type: "bar", data: { labels: ["a"], datasets: [{ label: "Llamadas atendidas", data: [1] }] },\n' +
  '    options: { indexAxis: "y", responsive: false, animation: false, plugins: { legend: { display: false } } } });\n' +
  '  var bg = ch.getDatasetMeta(0).data[0].options.backgroundColor; ch.destroy(); cv.remove(); return bg; }\n' +
  // Donde queda la leyenda: dentro de la tarjeta del Pareto, justo debajo de
  // su lienzo, sin el parrafo de poblacion; y, con la tarjeta a 320 px, que
  // envuelva sin salirse.
  'async function leyendaPareto() { var raiz = document.getElementById("tab-concentracion") || document;\n' +
  '  var leys = raiz.querySelectorAll(".conc-leyenda"), ley = leys[0], card = $c("chart-pareto").closest(".card");\n' +
  '  var lienzo = $c("chart-pareto").closest(".lienzo");\n' +
  '  var dentro = function (a, b) { return a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5; };\n' +
  '  var items = Array.prototype.map.call(ley.querySelectorAll("span"), function (x) { return x.textContent; });\n' +
  '  var muestras = Array.prototype.map.call(ley.querySelectorAll("i"), function (x) { var cs = getComputedStyle(x); return [x.className, cs.backgroundColor, cs.borderTopStyle]; });\n' +
  '  var ancho = [dentro(ley.getBoundingClientRect(), card.getBoundingClientRect()), ley.getBoundingClientRect().top >= lienzo.getBoundingClientRect().bottom - 0.5];\n' +
  '  var prev = card.style.width; card.style.width = "320px"; await espera(100);\n' +
  '  var tops = Array.prototype.map.call(ley.querySelectorAll("span"), function (x) { return Math.round(x.getBoundingClientRect().top); });\n' +
  '  var angosto = [dentro(ley.getBoundingClientRect(), card.getBoundingClientRect()), ley.scrollWidth <= ley.clientWidth,\n' +
  '    tops.filter(function (t, i) { return tops.indexOf(t) === i; }).length > 1];\n' +
  '  card.style.width = prev; await espera(100);\n' +
  '  return [leys.length, ley.closest(".card") === card, lienzo.nextElementSibling === ley, items, muestras, ancho, angosto,\n' +
  '    raiz.querySelectorAll(".conc-poblacion, .conc-pie").length, /vw_ServicioTickets|propio total/.test(raiz.textContent)]; }\n' +
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
  '  p.data.datasets[1].data.slice(0, 3), p.data.datasets[2].data.every(function (x) { return x === 80; }), p.data.datasets[2].borderColor,\n' +
  '  graf("categorias").data.datasets[0].backgroundColor[0], graf("grupos").data.datasets[0].backgroundColor[0],\n' +
  '  graf("grupos").data.datasets[0].backgroundColor[graf("grupos").data.labels.length - 1],\n' +
  '  getComputedStyle(document.querySelector(".conc-leyenda .conc-dentro")).backgroundColor]);\n' +
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
  'apunta("C13", [completa, parcial, nula]);\n' +
  // C14 leyenda
  'apunta("C14", await leyendaPareto());\n' +
  // C15 varios meses (2026-11-10): uno, agregar dos seguidos = UNA peticion,
  // quitar uno, quitar todos (el servidor da el actual).
  '$c("btn-limpiar").click(); await hasta(function () { var u = ultimaConc(); return !u.so && !u.grupo && !msg("pareto"); });\n' +
  // Limpiar ya dejo los meses en el actual (C18): elegirlo no repide.
  'elegir("mes", ["2026-11"]); await hasta(function () { return marcados("mes").join() === "2026-11" && !msg("pareto"); }); await espera(150);\n' +
  'var uno =[$c("mes").multiple, marcados("mes"), $c("activos").textContent.split(" · ").slice(0, 2).join(" · ")];\n' +
  'var n15 = pedidasConc().length;\n' +
  'elegir("mes", ["2026-11", "2026-09"]); elegir("mes", ["2026-11", "2026-09", "2026-07"]);\n' +
  'await hasta(function () { return pedidasConc().length > n15 && !msg("pareto") && /Meses/.test($c("activos").textContent); }); await espera(200);\n' +
  'var agregar = [pedidasConc().length - n15, ultimaConc(), marcados("mes"), $c("activos").textContent.split(" · ").slice(0, 2).join(" · "),\n' +
  '  graf("pareto").options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]), M().filtros().meses];\n' +
  'elegir("mes", ["2026-11", "2026-07"]); await hasta(function () { return ultimaConc().mes === "2026-11|2026-07" && !msg("pareto"); }); await espera(150);\n' +
  'var quitar = [ultimaConc().mes, marcados("mes"), $c("activos").textContent.split(" · ").slice(0, 2).join(" · ")];\n' +
  'var n15b = pedidasConc().length;\n' +
  'elegir("mes", []); await hasta(function () { return pedidasConc().length > n15b && !msg("pareto"); }); await espera(150);\n' +
  'var vacio = [ultimaConc(), marcados("mes"), /^Periodo: Mes Mes 2026-11 \\(en curso, hasta hoy\\)/.test($c("activos").textContent)];\n' +
  'var n15c = pedidasConc().length; elegir("mes", ["2026-11"]); await espera(500);\n' +
  'apunta("C15", [uno, agregar, quitar, vacio, pedidasConc().length - n15c]);\n' +
  // C16 Slot acumulado y cambio de modo: de Mes (varios) a Slot y vuelta.
  'elegir("mes", ["2026-10", "2026-08"]); await hasta(function () { return ultimaConc().mes === "2026-10|2026-08" && !msg("pareto"); });\n' +
  'var n16 = pedidasConc().length;\n' +
  'document.querySelector("#conc-filtros [data-modo=slot]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "slot" && !msg("pareto"); }); await espera(100);\n' +
  'var aSlot = [pedidasConc().slice(n16), $c("campo-mes").hidden, $c("campo-slot").hidden];\n' +
  'var acum = [];\n' +
  'for (var k = 1; k <= 3; k++) { var nk = pedidasConc().length; $c("slot-mas").click();\n' +
  '  await hasta(function () { return ultimaConc().slot === String(k) && !msg("pareto") && new RegExp("Slots 0-" + k + " ").test($c("activos").textContent); }); await espera(80);\n' +
  '  acum.push([pedidasConc().length - nk, $c("activos").textContent.split(" · ").slice(0, 2).join(" · ")]); }\n' +
  'var nv = pedidasConc().length;\n' +
  'document.querySelector("#conc-filtros [data-modo=mes]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "mes" && !msg("pareto"); }); await espera(100);\n' +
  'var aMes = [pedidasConc().slice(nv), marcados("mes")];\n' +
  'document.querySelector("#conc-filtros [data-modo=slot]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "slot" && !msg("pareto"); }); await espera(100);\n' +
  'apunta("C16", [aSlot, acum, aMes, ultimaConc(), $c("slot-n").value]);\n' +
  // C17 (2026-11-11) espera de meses y cancelacion.
  // a) Desplegable de meses abierto: cada clic pausado (mas que la espera)
  //    pide con lo marcado hasta ese momento, sin esperar a cerrarlo; cerrar
  //    no pide nada mas. Tres clics rapidos dentro del desplegable = UNA.
  'document.querySelector("#conc-filtros [data-modo=mes]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "mes" && !msg("pareto"); }); await espera(150);\n' +
  'var env = $c("mes").parentNode, boton = env.querySelector(".dd-boton");\n' +
  'var fila = function (v) { var i = Array.prototype.map.call($c("mes").options, function (o) { return o.value; }).indexOf(v);\n' +
  '  return env.querySelector(".dd-opcion[data-indice=\\"" + i + "\\"]"); };\n' +
  'var n17 = pedidasConc().length; boton.click();\n' +
  'fila("2026-06").click(); await espera(900); fila("2026-05").click(); await espera(900); fila("2026-04").click(); await espera(900);\n' +
  'var abierto = [env.classList.contains("abierto"), pedidasConc().length - n17, pedidasConc().slice(n17).map(function (o) { return o.mes; })];\n' +
  'var n17r = pedidasConc().length;\n' +
  'fila("2026-03").click(); await espera(150); fila("2026-02").click(); await espera(150); fila("2026-01").click();\n' +
  'await hasta(function () { return pedidasConc().length > n17r && !msg("pareto"); }); await espera(900);\n' +
  'var rapidos = [pedidasConc().length - n17r, ultimaConc().mes];\n' +
  'var n17c = pedidasConc().length; Desplegable.cerrarTodos(); await espera(900);\n' +
  'var cerrado = [pedidasConc().length - n17c, env.classList.contains("abierto")];\n' +
  // b) Sin abrir el desplegable, tres cambios a 300 ms = UNA peticion.
  'var n17b = pedidasConc().length;\n' +
  'elegir("mes", ["2026-10"]); await espera(300); elegir("mes", ["2026-10", "2026-09"]); await espera(300); elegir("mes", ["2026-10", "2026-09", "2026-08"]);\n' +
  'await hasta(function () { return pedidasConc().length > n17b && !msg("pareto"); }); await espera(900);\n' +
  'var rafaga = [pedidasConc().length - n17b, ultimaConc().mes];\n' +
  // c) Una peticion reemplazada se cancela: sin error, sin "Calculando…" pegado.
  'document.querySelector("#conc-filtros [data-modo=slot]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "slot" && !msg("pareto"); }); await espera(100);\n' +
  'var a0 = __abortadas; window.__lento = 600;\n' +
  '$c("slot-menos").click(); await espera(100); $c("slot-menos").click();\n' +
  'await hasta(function () { return /^Periodo: Slots 0-1 /.test($c("activos").textContent) && !msg("pareto"); }); window.__lento = 0; await espera(800);\n' +
  'var cancelada = [__abortadas - a0, slots().slice(-2), $c("error").hidden, msg("pareto"), msg("categorias"), msg("grupos"),\n' +
  '  lineas().some(function (l) { return /Error|No se pudo/.test(l); }), graf("pareto").options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }])];\n' +
  // d) Aunque la cancelacion no llegue, una respuesta vieja y lenta no pinta encima de la nueva.
  'window.__ignoraAbort = true; window.__demora = function (u) { return /slot=0/.test(u) ? 800 : 0; };\n' +
  '$c("slot-menos").click(); await espera(60); $c("slot-mas").click();\n' +
  'await espera(1300); window.__ignoraAbort = false; window.__demora = null;\n' +
  'var vieja = [slots().slice(-2), /^Periodo: Slots 0-1 /.test($c("activos").textContent), graf("pareto").options.plugins.tooltip.callbacks.title([{ dataIndex: 0 }]),\n' +
  '  $c("slot-n").value, msg("pareto")];\n' +
  // e) "Actualizar" con meses pendientes: UNA peticion, con los meses nuevos.
  'document.querySelector("#conc-filtros [data-modo=mes]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "mes" && !msg("pareto"); }); await espera(150);\n' +
  'var n17e = pedidasConc().length;\n' +
  'elegir("mes", ["2026-07"]); $c("btn-actualizar").click();\n' +
  'await hasta(function () { return pedidasConc().length > n17e && !msg("pareto"); }); await espera(1200);\n' +
  'var actualizar = [pedidasConc().length - n17e, ultimaConc().mes];\n' +
  'apunta("C17", [abierto, rapidos, cerrado, rafaga, cancelada, vieja, actualizar]);\n' +
  // C18 (2026-11-11) "Limpiar" quita los meses elegidos. `ahora()` lee los
  // tres lados: <select>, desplegable (filas marcadas y contador) y filtros.
  'var ahora = function () { return [marcados("mes"), env.querySelectorAll(".dd-opcion.marcada").length,\n' +
  '  env.querySelector(".dd-conteo") ? env.querySelector(".dd-conteo").textContent : null, M().filtros().meses]; };\n' +
  // a) Ocho meses con el desplegable, Limpiar: cero en los tres lados al
  //    instante, UNA peticion sin mes, luego el actual (lo de siempre).
  'var n18 = pedidasConc().length; boton.click();\n' +
  '["2026-10", "2026-09", "2026-08", "2026-06", "2026-05", "2026-04", "2026-03"].forEach(function (v) { fila(v).click(); });\n' +
  'await hasta(function () { return pedidasConc().length > n18 && !msg("pareto"); }); await espera(900);\n' +
  'var ocho = [ahora(), pedidasConc().length - n18, ultimaConc().mes.split("|").length, env.classList.contains("abierto")];\n' +
  'var n18a = pedidasConc().length; $c("btn-limpiar").click();\n' +
  'var alInstante = ahora().concat([env.classList.contains("abierto")]);\n' +
  'await hasta(function () { return pedidasConc().length > n18a && !msg("pareto"); }); await espera(900);\n' +
  'var limpioOcho = [alInstante, pedidasConc().length - n18a, ultimaConc(), ahora(),\n' +
  '  $c("activos").textContent.split(" · ").slice(0, 1).join(), M().filtros().so, M().filtros().grupo, M().filtros().modo];\n' +
  // b) Un mes elegido, abriendo y cerrando el desplegable antes de Limpiar.
  'boton.click(); fila("2026-11").click(); fila("2026-05").click();\n' +
  'var n18b = pedidasConc().length;\n' +
  'await hasta(function () { return pedidasConc().length > n18b && !msg("pareto"); }); await espera(900);\n' +
  'Desplegable.cerrarTodos(); var unMes = [ahora(), ultimaConc().mes];\n' +
  'boton.click(); await espera(100); Desplegable.cerrarTodos(); await espera(100);\n' +
  'var n18c = pedidasConc().length; $c("btn-limpiar").click(); var alInstanteUno = ahora();\n' +
  'await hasta(function () { return pedidasConc().length > n18c && !msg("pareto"); }); await espera(900);\n' +
  'var limpioUno = [unMes, alInstanteUno, pedidasConc().length - n18c, ultimaConc(), ahora()];\n' +
  // c) Clics aun en la espera de meses (sin pedir) y Limpiar: UNA peticion,
  //    sin mes; la espera descartada no pide despues.
  'var n18d = pedidasConc().length; boton.click(); fila("2026-02").click(); fila("2026-01").click();\n' +
  'await espera(100); var pendiente = pedidasConc().length - n18d; $c("btn-limpiar").click();\n' +
  'await hasta(function () { return pedidasConc().length > n18d && !msg("pareto"); }); await espera(1200);\n' +
  'var conEspera = [pendiente, pedidasConc().length - n18d, ultimaConc(), ahora()];\n' +
  // d) El desplegable sigue sirviendo: elegir otra vez = UNA peticion.
  'var n18e = pedidasConc().length; boton.click(); fila("2026-09").click(); fila("2026-08").click();\n' +
  'await hasta(function () { return pedidasConc().length > n18e && !msg("pareto"); }); await espera(900); Desplegable.cerrarTodos();\n' +
  'var otraVez = [pedidasConc().length - n18e, ultimaConc().mes, ahora()];\n' +
  // e) Nada que quitar (Slot, sin SO ni Grupo): ninguna peticion; los meses
  //    se quitaron igual, y volver a Mes pide sin mes (el actual).
  'document.querySelector("#conc-filtros [data-modo=slot]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "slot" && !msg("pareto"); }); await espera(150);\n' +
  'var n18f = pedidasConc().length; $c("btn-limpiar").click(); await espera(900);\n' +
  'var nada = [pedidasConc().length - n18f, M().filtros().meses, M().filtros().slot];\n' +
  'var n18g = pedidasConc().length; $c("btn-limpiar").click(); await espera(900); nada.push(pedidasConc().length - n18g);\n' +
  'document.querySelector("#conc-filtros [data-modo=mes]").click();\n' +
  'await hasta(function () { return ultimaConc().modo === "mes" && !msg("pareto"); }); await espera(150);\n' +
  'nada.push(pedidasConc().slice(n18g), marcados("mes"));\n' +
  'apunta("C18", [ocho, limpioOcho, limpioUno, conEspera, otraVez, nada]);\n');

var sondaD = conComun(
  'await hasta(function () { return !!document.getElementById("conc-chart-pareto") && window.TableroConcentracionModulo && Chart.getChart(document.getElementById("conc-chart-pareto")); }, 8000);\n' +
  'var b = document.getElementById("snav-concentracion"), g = document.getElementById("mtab-servicios");\n' +
  'apunta("D1", [b.textContent, g.querySelector(".mnav-txt").textContent, b.classList.contains("active"), b.getAttribute("aria-current"),\n' +
  '  g.classList.contains("active"), g.getAttribute("aria-current"), !document.querySelector(".subnav[data-grupo=servicios]").hidden,\n' +
  '  document.getElementById("tab-concentracion").classList.contains("active"), slots(), __pedidas["an-servicios"] || 0,\n' +
  '  __pedidas["an-otro"] || 0, document.getElementById("tab-analisis").childElementCount,\n' +
  '  document.querySelector("#tab-concentracion h1").textContent, colorAgente(),\n' +
  '  Chart.getChart(document.getElementById("conc-chart-pareto")).data.datasets[0].backgroundColor[0]]);\n' +
  'activarTab("analisis");\n' +
  'await hasta(function () { return (__pedidas["an-servicios"] || 0) >= 1 && document.querySelector("#tab-analisis select"); }, 8000);\n' +
  'await espera(300);\n' +
  'apunta("D2", [__pedidas["an-servicios"], __pedidas["an-otro"] || 0, document.getElementById("snav-analisis").getAttribute("aria-current"), document.getElementById("mtab-servicios").getAttribute("aria-current"),\n' +
  '  document.getElementById("tab-concentracion").classList.contains("active")]);\n' +
  'var c0 = __pedidas.conc;\n' +
  'activarTab("concentracion"); await espera(300);\n' +
  'apunta("D3", [__pedidas.conc - c0, document.querySelectorAll("script[src*=\\"concentracion.js\\"]").length, !!Chart.getChart(document.getElementById("conc-chart-pareto"))]);\n' +
  'apunta("D4", await leyendaPareto());\n');

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
  // El azul que SE VE en "Atencion por agente" (plugin Colors de Chart.js para
  // una serie sin color); D1 lo mide en dashboard.html y lo compara.
  var AZUL = 'rgba(54, 162, 235, 0.5)', CLARO = 'rgba(54, 162, 235, 0.2)';
  seccion(0, 'C', function (o) {
    Check('C1 carga sola con modo=slot&slot=0, tres graficas, periodo del servidor, sin Analisis, control de Slot visible',
      [[{ modo: 'slot', slot: '0' }], true, true, true,
       'Periodo: Slot 0 · del 11/10/2026 al 09/11/2026 · Service Owner: todos · Grupo: todos · 500 tickets en el periodo', 0, 0, false, true], o.C1);
    // Acumulado 24, 42, 56, 67, 76, 83 -> 6 dentro.
    Check('C2 Pareto: Top 10 de 12, azul de "Atencion por agente" hasta el 80 %, la misma familia mas tenue despues; linea ambar y referencia gris sin cambio; categorias, grupos y leyenda con el mismo azul',
      [10, [AZUL, AZUL, AZUL, AZUL, AZUL, AZUL, CLARO, CLARO, CLARO, CLARO], 'line', '#d39a3a', [24, 42, 56], true, '#8a94a6',
       AZUL, AZUL, CLARO, AZUL], o.C2);
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
    Check('C15 varios meses: selector multiple; agregar dos seguidos = UNA peticion mes=2026-11|2026-09|2026-07 con las tres graficas y el texto de esos meses; quitar uno; quitarlos todos = el servidor da el actual y lo marca; el mismo conjunto no repide',
      [[true, ['2026-11'], 'Periodo: Mes Mes 2026-11 (en curso, hasta hoy) · del 01/11/2026 al 09/11/2026'],
       [1, { modo: 'mes', mes: '2026-11|2026-09|2026-07' }, ['2026-11', '2026-09', '2026-07'],
        'Periodo: Meses Mes 2026-11 (en curso, hasta hoy), Mes 2026-09, Mes 2026-07 · 65 días',
        'Servicio 1 mes 2026-11+2026-09+2026-07', ['2026-11', '2026-09', '2026-07']],
       ['2026-11|2026-07', ['2026-11', '2026-07'], 'Periodo: Meses Mes 2026-11 (en curso, hasta hoy), Mes 2026-07 · 37 días'],
       [{ modo: 'mes' }, ['2026-11'], true], 0], o.C15);
    Check('C16 de Mes (varios) a Slot: pide slot=0 sin mes; Slot acumulado 1..3 = una peticion cada uno, "Slots 0-N" del inicio del Slot N a ayer de la vista; volver a Mes conserva los meses; volver a Slot conserva el 3',
      [[[{ modo: 'slot', slot: '0' }], true, false],
       [[1, 'Periodo: Slots 0-1 · del 11/09/2026 al 09/11/2026'], [1, 'Periodo: Slots 0-2 · del 12/08/2026 al 09/11/2026'],
        [1, 'Periodo: Slots 0-3 · del 13/07/2026 al 09/11/2026']],
       [[{ modo: 'mes', mes: '2026-10|2026-08' }], ['2026-10', '2026-08']], { modo: 'slot', slot: '3' }, '3'], o.C16);
    Check('C17 meses: con el desplegable abierto cada clic pausado pide (sin esperar a cerrarlo); tres clics rapidos = UNA; cerrar no pide; tres cambios rapidos sin desplegable = UNA; la peticion reemplazada se cancela sin error ni "Calculando…"; una respuesta vieja no pinta encima; "Actualizar" con meses pendientes = UNA',
      [[true, 3, ['2026-10|2026-08|2026-06', '2026-10|2026-08|2026-06|2026-05', '2026-10|2026-08|2026-06|2026-05|2026-04']],
       [1, '2026-10|2026-08|2026-06|2026-05|2026-04|2026-03|2026-02|2026-01'], [0, false], [1, '2026-10|2026-09|2026-08'],
       [1, ['2', '1'], true, null, null, null, false, 'Servicio 1 slot 1'],
       [['0', '1'], true, 'Servicio 1 slot 1', '1', null], [1, '2026-07']], o.C17);
    var OCHO = ['2026-10', '2026-09', '2026-08', '2026-07', '2026-06', '2026-05', '2026-04', '2026-03'];
    var ACTUAL = [['2026-11'], 1, '1', ['2026-11']];
    Check('C18 Limpiar quita los meses: ocho elegidos en el desplegable = cero en <select>, desplegable y filtros al instante y UNA peticion sin mes (el servidor da el actual), SO/Grupo vacios y el modo igual; un mes, tras abrir y cerrar = UNA; con clics en la espera = UNA y nada despues; elegir otra vez = UNA; en Slot sin nada que quitar = ninguna, y volver a Mes pide sin mes',
      [[[OCHO, 8, '8', OCHO], 1, 8, true],
       [[[], 0, '', [], false], 1, { modo: 'mes' }, ACTUAL, 'Periodo: Mes Mes 2026-11 (en curso, hasta hoy)', [], [], 'mes'],
       [[[['2026-05'], 1, '1', ['2026-05']], '2026-05'], [[], 0, '', []], 1, { modo: 'mes' }, ACTUAL],
       [0, 1, { modo: 'mes' }, ACTUAL],
       [1, '2026-11|2026-09|2026-08', [['2026-11', '2026-09', '2026-08'], 3, '3', ['2026-11', '2026-09', '2026-08']]],
       [0, [], 1, 0, [{ modo: 'mes' }], ['2026-11']]], o.C18);
    Check('C13 cobertura: completa sin aviso; parcial con el hecho; sin medir sin aviso',
      [true, [false, 'Cobertura parcial: hay tickets en 16 de 30 días del periodo · datos del 19/11/2025 al 14/12/2025.'], true], o.C13);
  });
  seccion(1, 'D', function (o) {
    Check('D1 #concentracion: Servicios marcada en la barra y "Vista general de servicios" en su selector (visible), montada, pide slot 0, Analisis sin tocar; el azul medido de una barra sin color (Atencion por agente) = el de la pestaña',
      ['Vista general de servicios', 'Servicios', true, 'page', true, 'page', true, true, ['0'], 0, 0, 0,
       'Tickets Proactivanet — Vista general de servicios', AZUL, AZUL], o.D1);
    Check('D2 Analisis igual que siempre: solo la lista de servicios, nada analizado', [1, 0, 'page', 'page', false], o.D2);
    Check('D3 volver: sin montar de nuevo ni repedir', [0, 1, true], o.D3);
  });
  // C14 / D4: la leyenda del Pareto, sola y embebida.
  var LEYENDA = [1, true, true,
    ['Hasta alcanzar el 80 % acumulado', 'Resto', '% acumulado (Pareto)', 'Referencia 80 %'],
    [['conc-dentro', AZUL, 'none'], ['conc-fuera', CLARO, 'none'], ['conc-linea', 'rgb(211, 154, 58)', 'none'],
     ['conc-ref', 'rgba(0, 0, 0, 0)', 'dashed']],
    [true, true], [true, true, true], 0, false];
  [[0, 'C14'], [1, 'D4']].forEach(function (x) {
    if (!res[x[0]]) return;
    Check(x[1] + ' leyenda: una sola, dentro de la tarjeta del Pareto y justo debajo de su lienzo; los cuatro rotulos y colores; a 320 px envuelve sin salirse; sin el parrafo de poblacion',
      LEYENDA, Banco.mapa(res[x[0]])[x[1]]);
  });
  console.log(fallos ? fallos + ' FALLARON' : 'TODO PASA');
  process.exit(fallos ? 1 : 0);
});
