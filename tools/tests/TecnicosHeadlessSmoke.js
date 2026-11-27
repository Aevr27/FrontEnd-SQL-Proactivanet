// tools/tests/TecnicosHeadlessSmoke.js - la pestaña Tecnicos (tecnicos/) en
// un Chrome de verdad.
//
// NO forma parte del sitio. Sirve el repositorio con el banco de
// tools/tests/BancoHeadless.js y, en memoria, una copia de
// tecnicos/tecnicos.html con un fetch de mentira (la respuesta de
// tecnicos.ashx) y una sonda que lee y pulsa la pagina. No escribe en disco.
//
//   T1-T5   KPIs, barra, Pareto, tabla por tecnico (orden y NULL = "—");
//   E1-E7   evidencia: paginacion, busqueda, estado, expandir, tecnico;
//   P1      la peticion lleva las dos fechas;
//   B1      un bloque que falla (?falla=tecnicos) no tumba a los demas;
//   X1      falla la peticion entera (?todo=500): banda de error;
//   V1      rango vacio (?vacio=1): ceros, "—" y mensajes de sin datos;
//   S1      sql/47 (?tipo=1): aparece la columna de tipo; sin ella, no;
//   D1      fecha inicio > fin: no se pide nada y se avisa;
//   N1-N7   dashboard.html#tecnicos: carga perezosa en Calidad, QA y QARE sin
//           montar, hoja acotada, volver no remonta ni repite la peticion.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\TecnicosHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
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

// ---- respuesta de mentira de tecnicos.ashx ---------------------------------
var detalle = [];
for (var i = 1; i <= 60; i++) {
  detalle.push({
    CodigoTicket: 'INC 2026-' + (450000 + i), FechaFirmaSolucion: '2026-11-26T15:39:42',
    FirmaSolucion: i % 3 === 0 ? 'Perez, Ana' : 'Soto, Luis', Grupo: 'Mesa', Categoria: '/Cat/Sub', Validacion: 'OK',
    QARe_Causa: 'Necesidad del Usuario', QARe_AplicaOtrosCasos: 'No', QARe_GenerarArticulo: 'No', QARe_VerificoClasificacion: 'Sí',
    QARe_TipoSolucion: 'Se otorgan permisos',
    QARe_DescripcionSolucion: i === 7 ? 'Se reinició el servicio de la báscula' : 'texto ' + i,
    EstadoDescripcionVisual: i % 4 === 0 ? 'RESPUESTA INVALIDA' : 'RESPUESTA ANALIZABLE',
    ClasificacionRespuesta: i % 4 === 0 ? null : 'SIN PATRON IDENTIFICADO',
  });
}
var BASE = {
  fechaInicio: '2026-11-13', fechaFin: '2026-11-27',
  kpis: { TicketsTotales: 8304, TicketsSinInformacionQARE: 1588, TicketsEvaluados: 6716, TicketsNoEvaluables: 2581,
    PctNoEvaluable: 38.43, TicketsTextoEvaluable: 4135, PctTextoEvaluable: 61.57 },
  distribucion: [{ ClasificacionRespuesta: 'SIN PATRON IDENTIFICADO', TipoClasificacionRespuesta: 'SIN PATRON', Tickets: 1690, Porcentaje: 40.87 }],
  pareto: [
    { Posicion: 1, PatronSolucion: 'ACTUALIZACION / INSTALACION', Tickets: 278, Porcentaje: 13.83, TicketsAcumulados: 278, PctAcumulado: 13.83 },
    { Posicion: 2, PatronSolucion: 'REINICIO / REACTIVACION', Tickets: 273, Porcentaje: 13.58, TicketsAcumulados: 551, PctAcumulado: 27.41 },
    { Posicion: 3, PatronSolucion: 'INDICACIONES / CANALIZACION', Tickets: 221, Porcentaje: 11.00, TicketsAcumulados: 772, PctAcumulado: 38.41 },
  ],
  resumen: { TotalTextoEvaluable: 4135, TicketsConPatron: 2010, PctConPatron: 48.61, TicketsCalidad: 435, PctCalidad: 10.52,
    TicketsSinPatron: 1690, PctSinPatron: 40.87 },
  tecnicos: [
    { FirmaSolucion: 'Soto, Luis', TicketsTotales: 480, TicketsSinInformacionQARE: 0, TicketsEvaluados: 480, TicketsNoEvaluables: 346,
      PctNoEvaluable: 72.08, TicketsTextoEvaluable: 134, PctTextoEvaluable: 27.92, TicketsConPatron: 78, PctConPatron: 58.21,
      TicketsCalidad: 0, PctCalidad: 0, TicketsSinPatron: 56, PctSinPatron: 41.79 },
    { FirmaSolucion: 'Perez, Ana', TicketsTotales: 155, TicketsSinInformacionQARE: 0, TicketsEvaluados: 155, TicketsNoEvaluables: 155,
      PctNoEvaluable: 100, TicketsTextoEvaluable: 0, PctTextoEvaluable: 0, TicketsConPatron: 0, PctConPatron: null,
      TicketsCalidad: 0, PctCalidad: null, TicketsSinPatron: 0, PctSinPatron: null },
  ],
  detalle: detalle, detalleTraeTipo: false, errores: {}, avisos: [],
  dataInfo: null,
};

var STUB = '<script>\n' +
  'window.__peticiones = [];\n' +
  'var __BASE = ' + JSON.stringify(BASE) + ';\n' +
  'window.fetch = function (u) { u = String(u); __peticiones.push(u);\n' +
  '  var q = location.search, d = JSON.parse(JSON.stringify(__BASE)), estado = 200;\n' +
  '  if (/falla=tecnicos/.test(q)) { d.tecnicos = null; d.errores = { tecnicos: "No se pudo consultar dbo.usp_QARE_CalidadCaptura_Tecnicos (error 50000)." }; }\n' +
  '  if (/vacio=1/.test(q)) { d.kpis = { TicketsTotales: 0, TicketsSinInformacionQARE: 0, TicketsEvaluados: 0, TicketsNoEvaluables: 0, PctNoEvaluable: null, TicketsTextoEvaluable: 0, PctTextoEvaluable: null };\n' +
  '    d.distribucion = []; d.pareto = []; d.resumen = null; d.tecnicos = []; d.detalle = []; }\n' +
  '  if (/tipo=1/.test(q)) { d.detalleTraeTipo = true; d.detalle.forEach(function (f, i) { f.TipoClasificacionRespuesta = i % 4 === 3 ? null : "SIN PATRON"; }); }\n' +
  '  if (/todo=500/.test(q)) { estado = 500; d = { error: "No se pudo consultar los procedimientos.", tipo: "SqlException" }; }\n' +
  '  var txt = JSON.stringify(d);\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: estado === 200, status: estado,\n' +
  '    text: function () { return Promise.resolve(txt); }, json: function () { return Promise.resolve(JSON.parse(txt)); } }); }, 20); }); };\n' +
  '</script>\n';

// ---- la sonda (corre en la pagina) ----
function sonda() {
  var R = {}, errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 4000; t += 25) await espera(25); return fn(); }
  function q(s) { return document.querySelector(s); }
  function qa(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }
  function txt(s) { var n = q(s); return n ? n.textContent.trim() : null; }
  function cambiar(el, v, tipo) { el.value = v; el.dispatchEvent(new Event(tipo || 'change', { bubbles: true })); }

  (async function () {
    await hasta(function () { return window.__peticiones.length > 0 && (q('#tec-tabla-evidencia table') || q('#tec-tabla-evidencia .vacio:not(:empty)') && !/Calculando/.test(txt('#tec-tabla-evidencia'))); });
    await espera(100);
    var busq = location.search;
    R.peticion = window.__peticiones[0];
    R.kpis = qa('#tec-kpis .kpi').map(function (k) { return [k.querySelector('.lbl').textContent, k.querySelector('.val').textContent, k.querySelector('.foot').textContent]; });
    R.barra = qa('#tec-barra .tec-seg').map(function (s) { return s.style.width; });
    R.leyenda = qa('#tec-barra-leyenda .tec-ley b').map(function (b) { return b.textContent; });
    R.msgBarra = q('#tec-msg-barra').hidden ? null : txt('#tec-msg-barra');
    R.msgPareto = q('#tec-msg-pareto').hidden ? null : txt('#tec-msg-pareto');
    R.hintPareto = txt('#tec-hint-pareto');
    R.tecnicos = qa('#tec-tabla-tecnicos tbody tr').map(function (tr) { return tr.children[0].textContent; });
    R.tecVacio = txt('#tec-tabla-tecnicos .vacio');
    R.tecNulo = qa('#tec-tabla-tecnicos tbody tr').length > 1 ? q('#tec-tabla-tecnicos tbody tr:nth-child(2) td:nth-child(6) .tec-pct').textContent : null;
    R.encabezados = qa('#tec-tabla-evidencia thead th').map(function (th) { return th.textContent; });
    R.pag1 = txt('#tec-paginacion-txt');
    R.filas1 = qa('#tec-tabla-evidencia tbody tr.tec-fila').length;
    R.tipos = qa('#tec-tabla-evidencia tbody tr.tec-fila td:last-child').slice(0, 4).map(function (td) { return td.textContent; });
    R.errorBanda = q('#tec-error').hidden ? null : txt('#tec-error-msg');
    R.evidVacio = txt('#tec-tabla-evidencia .vacio');

    if (!busq) {
      q('#tec-btn-next').click(); await espera(30);
      R.pag2 = txt('#tec-paginacion-txt');
      cambiar(q('#tec-f-tamano'), '50'); await espera(30);
      R.pag50 = txt('#tec-paginacion-txt');
      cambiar(q('#tec-f-tamano'), '25'); await espera(30);
      cambiar(q('#tec-f-buscar'), 'REINICIO', 'input'); await espera(300);
      R.busqueda = [txt('#tec-paginacion-txt'), qa('#tec-tabla-evidencia tbody tr.tec-fila td.tec-ticket').map(function (t) { return t.textContent; })];
      cambiar(q('#tec-f-buscar'), '', 'input'); await espera(300);
      R.estados = qa('#tec-f-estado option').map(function (o) { return o.value; });
      cambiar(q('#tec-f-estado'), 'RESPUESTA INVALIDA'); await espera(30);
      R.porEstado = txt('#tec-paginacion-txt');
      cambiar(q('#tec-f-estado'), ''); await espera(30);
      q('#tec-tabla-evidencia .tec-exp').click(); await espera(30);
      R.expandir = [q('#tec-tabla-evidencia .tec-exp').getAttribute('aria-expanded'), qa('#tec-tabla-evidencia tr.tec-ctx').length,
        txt('#tec-tabla-evidencia tr.tec-ctx dd')];
      R.puedeRefrescarAbierto = window.TableroTecnicosModulo.puedeRefrescar();
      q('#tec-tabla-evidencia .tec-exp').click(); await espera(30);
      R.cerrar = [qa('#tec-tabla-evidencia tr.tec-ctx').length, window.TableroTecnicosModulo.puedeRefrescar()];
      q('#tec-tabla-tecnicos tbody tr:nth-child(2)').click(); await espera(30);
      R.porTecnico = [txt('#tec-paginacion-txt'), !q('#tec-chip-firma').hidden, txt('#tec-chip-firma-txt'),
        q('#tec-tabla-tecnicos tbody tr:nth-child(2)').getAttribute('aria-pressed')];
      q('#tec-chip-firma-quitar').click(); await espera(30);
      R.quitarTecnico = [txt('#tec-paginacion-txt'), q('#tec-chip-firma').hidden];
      var n = window.__peticiones.length;
      cambiar(q('#tec-f-inicio'), '2026-11-28'); await espera(80);
      R.fechasInvertidas = [window.__peticiones.length - n, !q('#tec-error').hidden, txt('#tec-error-msg')];
    }
    R.errores = errores;
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify(R);
    document.body.appendChild(pre);
  })();
}

// ---- embebida en dashboard.html#tecnicos (carga perezosa real) ----
var STUB_DASH = '<script>window.MockData.MOCK_DATA = true;\n' +
  'window.__pedidas = { tecnicos: 0, otras: [] };\n' +
  'var __BASE = ' + JSON.stringify(BASE) + ';\n' +
  // Solo los .ashx son de mentira: el montaje trae tecnicos.html y .css de verdad.
  'var __fetchReal = window.fetch;\n' +
  'window.fetch = function (u) { u = String(u); if (u.indexOf(".ashx") < 0) return __fetchReal.apply(this, arguments);\n' +
  '  var tec = u.indexOf("tecnicos.ashx") >= 0;\n' +
  '  if (tec) __pedidas.tecnicos++; else __pedidas.otras.push(u.split("?")[0].split("/").pop());\n' +
  '  var txt = JSON.stringify(tec ? __BASE : {});\n' +
  '  return Promise.resolve({ ok: true, status: 200, text: function () { return Promise.resolve(txt); },\n' +
  '    json: function () { return Promise.resolve(JSON.parse(txt)); } }); };\n' +
  '</script>\n';

function sondaDash() {
  var R = {}, errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 8000; t += 25) await espera(25); return fn(); }
  function id(x) { return document.getElementById(x); }
  (async function () {
   try {
    await hasta(function () { var k = document.querySelector('#tec-kpis .kpi .val'); return k && k.textContent === '8,304'; });
    await espera(150);
    R.montaje = [id('snav-tecnicos').classList.contains('active'), id('snav-tecnicos').getAttribute('aria-current'),
      id('mtab-calidad').classList.contains('active'), !document.querySelector('.subnav[data-grupo=calidad]').hidden,
      id('tab-tecnicos').classList.contains('active'), document.querySelector('#tab-tecnicos h1').textContent,
      document.querySelector('#tec-kpis .kpi .val').textContent, __pedidas.tecnicos];
    R.otrosSinMontar = [id('tab-qa').childElementCount, id('tab-qare').childElementCount];
    R.unaVez = [document.querySelectorAll('script[src*="tecnicos.js"]').length];
    R.hojaAcotada = Array.prototype.some.call(document.querySelectorAll('style'), function (st) {
      return /@scope\s*\(#tab-tecnicos\)/.test(st.textContent); });
    activarTab('sla'); await espera(200);
    activarTab('tecnicos'); await espera(300);
    R.volver = [__pedidas.tecnicos, document.querySelectorAll('script[src*="tecnicos.js"]').length,
      id('tab-tecnicos').classList.contains('active'), location.hash];
    R.otrasPeticiones = __pedidas.otras.filter(function (n) { return /qare|qa\.ashx/.test(n); });
   } catch (ex) {
    R.excepcion = String(ex);
    R.diag = [!!document.getElementById('tec-kpis'), location.hash, window.__pedidas,
      (document.getElementById('tab-tecnicos') || {}).childElementCount];
   }
    R.errores = errores;
    var pre = document.createElement('pre'); pre.id = '__res'; pre.textContent = JSON.stringify(R);
    document.body.appendChild(pre);
  })();
}

var BANCO = Banco.pagina('tecnicos/tecnicos.html', 'tecnicos.js', STUB, sonda);
var DASH = Banco.pagina('dashboard.html', 'dashboard.js', STUB_DASH, sondaDash);
var U = '/tecnicos/__banco.html';
Banco.correr({ '/tecnicos/__banco.html': BANCO, '/__banco_dash.html': DASH },
  [U, U + '?falla=tecnicos', U + '?todo=500', U + '?vacio=1', U + '?tipo=1', '/__banco_dash.html#tecnicos'], 90000).then(function (res) {
  var o = res[0], b = res[1], x = res[2], v = res[3], s = res[4], dd = res[5];
  if (dd && dd.excepcion) console.log('DIAG dashboard: ' + JSON.stringify([dd.excepcion, dd.diag, dd.errores]));
  if (!o || !b || !x || !v || !s || !dd) { console.log('FAIL  la sonda no devolvio resultado: ' + JSON.stringify(res.map(function (r) { return !!r; }))); process.exit(1); }

  Check('P1 la peticion lleva las dos fechas', true, /fecha_inicio=\d{4}-\d{2}-\d{2}&fecha_fin=\d{4}-\d{2}-\d{2}$/.test(o.peticion));
  Check('T1 cuatro tarjetas con los valores del SP', [
    ['Total de tickets', '8,304', 'Tickets firmados en el periodo'],
    ['Sin información QARE', '1,588', 'Sin respuesta abierta capturada'],
    ['Respuestas analizables', '4,135', '61.57 % de los evaluados'],
    ['Respuestas inválidas', '2,581', '38.43 % de los evaluados']], o.kpis);
  Check('T2 barra: anchos = Pct del SP', ['48.61%', '10.52%', '40.87%'], o.barra);
  Check('T2 barra: leyenda con el % del SP', ['48.61 %', '10.52 %', '40.87 %'], o.leyenda);
  Check('T3 Pareto pintado (sin mensaje)', [null, '3 patrones · % sobre todos los tickets con patrón'], [o.msgPareto, o.hintPareto]);
  Check('T4 tabla por tecnico en el orden del SP', ['Soto, Luis', 'Perez, Ana'], o.tecnicos);
  Check('T5 % NULL del SP se ve como —', '—', o.tecNulo);
  Check('E1 sin sql/47 no hay columna de tipo', false, o.encabezados.indexOf('Tipo de clasificación') !== -1);
  Check('E1 paginacion inicial', ['1–25 de 60 tickets · página 1 de 3', 25], [o.pag1, o.filas1]);
  Check('E2 siguiente pagina', '26–50 de 60 tickets · página 2 de 3', o.pag2);
  Check('E2 50 por pagina', '1–50 de 60 tickets · página 1 de 2', o.pag50);
  Check('E3 busqueda sin acentos', ['1–1 de 1 tickets · página 1 de 1', ['INC 2026-450007']], o.busqueda);
  Check('E4 estados del SP en el filtro', ['', 'RESPUESTA ANALIZABLE', 'RESPUESTA INVALIDA'], o.estados);
  Check('E4 filtro por estado', '1–15 de 15 tickets · página 1 de 1', o.porEstado);
  Check('E5 expandir muestra el contexto', ['true', 1, '2026-11-26 15:39'], o.expandir);
  Check('E6 con una fila abierta no se refresca solo', false, o.puedeRefrescarAbierto);
  Check('E6 cerrar la fila', [0, true], o.cerrar);
  Check('E7 clic en un tecnico filtra la evidencia', ['1–20 de 20 tickets · página 1 de 1', true, 'Técnico: Perez, Ana', 'true'], o.porTecnico);
  Check('E7 quitar el tecnico', ['1–25 de 60 tickets · página 1 de 3', true], o.quitarTecnico);
  Check('D1 inicio > fin: no pide y avisa', [0, true, 'Rango de fechas invalido: la fecha inicio debe ser anterior o igual a la fecha fin.'], o.fechasInvertidas);
  Check('sin errores de JavaScript', [], o.errores);

  Check('B1 falla Tecnicos: su tabla muestra el error', 'No se pudo consultar dbo.usp_QARE_CalidadCaptura_Tecnicos (error 50000).', b.tecVacio);
  Check('B1 falla Tecnicos: KPIs y evidencia siguen', ['8,304', '1–25 de 60 tickets · página 1 de 3'], [b.kpis[0][1], b.pag1]);
  Check('B1 sin banda de error general', null, b.errorBanda);
  Check('B1 sin errores de JavaScript', [], b.errores);

  Check('X1 falla todo: banda de error con el mensaje', 'No se pudo consultar los procedimientos.', x.errorBanda);
  Check('X1 falla todo: tarjetas en n/d', ['n/d', 'n/d', 'n/d', 'n/d'], x.kpis.map(function (k) { return k[1]; }));

  Check('V1 vacio: ceros y —', [['0', 'Tickets firmados en el periodo'], ['0', '— de los evaluados']],
    [[v.kpis[0][1], v.kpis[0][2]], [v.kpis[3][1], v.kpis[3][2]]]);
  Check('V1 vacio: mensajes de sin datos', ['Sin respuestas analizables en el rango.', 'Sin patrones reconocidos en el rango.',
    'Sin técnicos en el rango.', 'Sin tickets en el rango.'], [v.msgBarra, v.msgPareto, v.tecVacio, v.evidVacio]);
  Check('V1 vacio: sin errores de JavaScript', [], v.errores);

  Check('S1 con sql/47: columna de tipo', true, s.encabezados.indexOf('Tipo de clasificación') !== -1);
  Check('S1 tipo tal cual y NULL como —', ['SIN PATRON', 'SIN PATRON', 'SIN PATRON', '—'], s.tipos);

  Check('N1 #tecnicos monta la pestaña dentro de Calidad y pide una vez',
    [true, 'page', true, true, true, 'Tickets Proactivanet — Técnicos', '8,304', 1], dd.montaje);
  Check('N2 QA y QARE no se montan al abrir Tecnicos', [0, 0], dd.otrosSinMontar);
  Check('N3 un solo tecnicos.js', [1], dd.unaVez);
  Check('N4 la hoja queda acotada a #tab-tecnicos', true, dd.hojaAcotada);
  Check('N5 volver no remonta ni vuelve a pedir', [1, 1, true, '#tecnicos'], dd.volver);
  Check('N6 Tecnicos no pide qa.ashx ni qare.ashx', [], dd.otrasPeticiones);
  Check('N7 sin errores de JavaScript en el tablero', [], dd.errores);

  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
