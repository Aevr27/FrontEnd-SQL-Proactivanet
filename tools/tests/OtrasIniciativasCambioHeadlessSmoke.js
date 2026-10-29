// tools/tests/OtrasIniciativasCambioHeadlessSmoke.js - "Solicitar cambios" >
// Categorias: el indicador de OTRAS iniciativas activas de cada categoria,
// en un Chrome de verdad (tools/tests/BancoHeadless.js; no escribe en disco)
// con la pagina REAL admin/iniciativas.html y un fetch de mentira que hace
// de admin_sesion.ashx y del registro.
//
// La regla es la de CapacidadCategoria.Otras (la del servidor la prueba
// OtrasIniciativasCategoriaSmoke.cs); aqui se aplica al registro cargado:
//
//   R1-R4  otrasEnCategoria: solo activas con agrupador, sin la propia,
//          misma ruta sin espacios ni mayusculas, un folio dos veces suma.
//   I1-I4  el indicador: boton chico junto a la ruta (no un <select>), con
//          nombre accesible completo y title; sin otras activas no hay
//          indicador; cerrado por omision.
//   D1-D3  clic: abre el detalle (folio, %, estado, titulo, lo comprometido),
//          aria-expanded; otro clic lo pliega; es enfocable con teclado.
//   P1-P2  cambiar % <-> Tickets repinta el bloque: el detalle abierto sigue
//          abierto y el selector % / Tickets sigue funcionando.
//   W1     la fila no se ensancha: la tabla cabe en un contenedor de 360px.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\OtrasIniciativasCambioHeadlessSmoke.js   # sale 0 si todo paso
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

var RUTA_B = '/Servicios/Correo/Buzón compartido con un nombre largo para probar el ancho';
var RUTA_C = '/Servicios/Correo/Sin otras';

function ini(folio, estado, activa, cats, titulo) {
  return {
    folio: folio, titulo: titulo || 'Titulo ' + folio, titulo_problem: titulo || 'Titulo ' + folio, agrup: 'Problem', estado: estado,
    tickets_reduce: 0, vol_reduce_folio: 0, riesgo_folio: 0, retrazado: 0, sem_fecha: 'ambar', fecha_retrasada: false,
    f_analisis: '2026-12-01', f_solucion: null, f_cierre: null, n_analisis: 0, n_solucion: 0, n_cierre: 0, antiguedad: 10,
    po: 'PO 01', so: 'SO 01', director: 'Dir A', manager: null, descripcion: 'Desc', observaciones: null,
    activa: activa, seguimiento: activa, sin_categoria: !cats.length, prefijo: 'PRB', f_creacion: '2026-01-10',
    po_capturado: 'PO 01', so_capturado: 'SO 01',
    categorias: cats.map(function (c) {
      return { categoria: c[0], pct_dism: c[1], agrup: c[2] || 'Problem', tickets_reduce: 0, po: 'PO 01', so: 'SO 01', director: 'Dir A', n2: null };
    })
  };
}

var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'], agrupadores: ['Problem', 'SorIA', 'Adopcion', 'Mejora'], fecha_gen: '01/10/2026',
  tipos_iniciativa: [{ prefijo: 'PRB', nombre: 'Problem' }],
  persistencia_solicitudes: true,
  iniciativas: [
    ini('PRB 2026-000001', 'En Análisis', true, [[RUTA_B, 0.2], [RUTA_C, 0.1]]),
    ini('PRB 2026-000002', 'En Solución', true, [[RUTA_B, 0.25]], 'Reducir reenvios de correo'),
    ini('PRB 2026-000003', 'Cerrado', false, [[RUTA_B, 0.3]]),                       // cerrada: no
    ini('PRB 2026-000004', 'En Análisis', true, [[RUTA_B, 0.4, 'ReqOpr']]),          // sin agrupador: no
    ini('PRB 2026-000005', 'En Monitoreo', true, [['  ' + RUTA_B.toUpperCase() + ' ', 0.05], [RUTA_B, 0.05, 'Adopción']]),
    ini('PRB 2026-000006', 'En Solución', true, [[RUTA_B, null]])                    // % sin dato: 0
  ]
};

var ANTES = '<script>\n' +
  'window.fetch = function (u, op) { u = String(u && u.url || u); var j = {};\n' +
  '  if (/admin_sesion\\.ashx/.test(u)) j = { autorizado: true, rol: "ADM", solicitante: true };\n' +
  '  else if (/admin_iniciativas_registro/.test(u)) j = ' + JSON.stringify(REGISTRO) + ';\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 200,\n' +
  '    json: function () { return Promise.resolve(j); }, text: function () { return Promise.resolve(JSON.stringify(j)); } }); }, 10); }); };\n' +
  'Element.prototype.scrollIntoView = function () {};\n' +
  '</script>\n';

function sonda() {
  var R = [];
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function apunta(caso, v) { R.push([caso, v]); }
  function $(id) { return document.getElementById(id); }
  function clic(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  function boton(clave) { return document.querySelector('[data-cambio-otras="' + clave + '"]'); }
  (async function () {
    try {
      await espera(2500);
      var M = window.RegistroIniciativas, pag = window.IniciativasPagina.registro;
      var reg = pag.registro;
      var rutaB = reg.iniciativas[0].categorias[0].categoria, rutaC = reg.iniciativas[0].categorias[1].categoria;
      function folios(ruta, fuera) {
        return M.otrasEnCategoria(reg.iniciativas, reg.agrupadores, ruta, fuera).map(function (o) { return o.folio + ':' + Math.round(o.pct * 10000) / 100; });
      }
      apunta('R', [folios(rutaB, 'PRB 2026-000001'), folios(rutaC, 'PRB 2026-000001'), folios(rutaB, ''), folios('', '')]);

      pag.abrirDetalle('PRB 2026-000001');
      await espera(100);
      clic($('regCambioBoton'));
      var campo = $('regCambioCampo');
      campo.value = 'pct';
      campo.dispatchEvent(new Event('change', { bubbles: true }));
      await espera(50);
      var b0 = boton('l0'), b1 = boton('l1'), caja = $('regCambioOtras-l0');
      apunta('I', [!!b0, b0 && b0.tagName, b0 && b0.closest('td').classList.contains('ini-cat-ruta'),
                   document.querySelectorAll('#regCambioGrupoPct select:not([data-cambio-modo])').length,
                   b0 && b0.textContent.trim(), b0 && b0.title, b0 && b0.getAttribute('aria-expanded'), b0 && b0.getAttribute('aria-controls'),
                   !!caja && caja.hidden, !!b1, !!$('regCambioOtras-l1')]);
      b0.focus();
      apunta('foco', document.activeElement === b0);
      clic(b0);
      await espera(20);
      apunta('abierto', [caja.hidden, b0.getAttribute('aria-expanded'),
                         Array.prototype.map.call(caja.querySelectorAll('li'), function (li) { return li.textContent; }),
                         caja.querySelector('small').textContent]);
      // P: cambiar a Tickets repinta el bloque (pintarCategoriasCambio).
      var modo = document.querySelector('[data-cambio-modo="l0"]');
      modo.value = 'tickets';
      modo.dispatchEvent(new Event('change', { bubbles: true }));
      await espera(50);
      apunta('repinta', [!!document.querySelector('[data-cambio-tickets="l0"]'), $('regCambioOtras-l0').hidden,
                         boton('l0').getAttribute('aria-expanded')]);
      modo = document.querySelector('[data-cambio-modo="l0"]');
      modo.value = 'pct';
      modo.dispatchEvent(new Event('change', { bubbles: true }));
      await espera(50);
      apunta('vuelvePct', [!!document.querySelector('[data-cambio-tickets="l0"]'), !!document.querySelector('[data-cambio-pct="0"]'),
                           $('regCambioOtras-l0').hidden]);
      clic(boton('l0'));
      await espera(20);
      apunta('pliega', [$('regCambioOtras-l0').hidden, boton('l0').getAttribute('aria-expanded')]);
      // W: angosto. El bloque en 360px: la tabla no se sale de su caja.
      var g = $('regCambioGrupoPct');
      g.style.width = '360px';
      await espera(20);
      var t = g.querySelector('.ini-det-tabla'), bb = boton('l0').getBoundingClientRect(), td = boton('l0').closest('td').getBoundingClientRect();
      var con = t.scrollWidth - t.clientWidth;
      // La misma tabla sin indicadores: lo que ya desbordaba (la tabla tiene
      // su propio overflow-x) no es del indicador.
      Array.prototype.forEach.call(g.querySelectorAll('.ini-otras-boton'), function (x) { x.style.display = 'none'; });
      await espera(20);
      var sin = t.scrollWidth - t.clientWidth;
      apunta('angosto', { con: con, sin: sin, dentro: bb.right <= td.right + 0.5 && bb.left >= td.left - 0.5, alto: Math.round(bb.height) });
    } catch (e) { apunta('error', String(e && e.stack || e)); }
    var pre = document.createElement('pre'); pre.id = '__res';
    pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  })();
}

var paginas = { '/admin/__otras.html': Banco.pagina('admin/iniciativas.html', '../assets/js/sesion-admin.js', ANTES, sonda) };

Banco.correr(paginas, ['/admin/__otras.html']).then(function (res) {
  var A = Banco.mapa(res[0]);
  if (A.error) console.log('ERROR en la sonda: ' + A.error);
  var r = A.R || [];
  Check('R1 ruta B sin la propia: solo activas con agrupador (2, 5 con sus dos filas sumadas, 6 con % sin dato = 0); ni cerrada ni ReqOpr',
    ['PRB 2026-000002:25', 'PRB 2026-000005:10', 'PRB 2026-000006:0'], r[0]);
  Check('R2 ruta C: ninguna otra', [], r[1]);
  Check('R3 sin excluir: la propia tambien sale', ['PRB 2026-000001:20', 'PRB 2026-000002:25', 'PRB 2026-000005:10', 'PRB 2026-000006:0'], r[2]);
  Check('R4 sin ruta: nada', [], r[3]);
  var i = A.I || [];
  Check('I1 indicador: <button> dentro de la celda de la ruta; ningun <select> nuevo en el bloque (solo los de % / Tickets)',
    [true, 'BUTTON', true, 0], i.slice(0, 4));
  Check('I2 texto visible = 3 + nombre accesible completo; title explica', ['33 otras iniciativas activas en esta categoría',
    '3 otras iniciativas activas en esta categoría: ver sus %'], [i[4], i[5]]);
  Check('I3 cerrado por omision, controla su detalle', ['false', 'regCambioOtras-l0', true], [i[6], i[7], i[8]]);
  Check('I4 categoria sin otras activas: sin indicador ni detalle', [false, false], [i[9], i[10]]);
  Check('D1 enfocable con teclado', true, A.foco);
  var ab = A.abierto || [];
  Check('D2 clic abre: aria-expanded, folio, %, estado, titulo; lo comprometido por otras',
    [false, 'true', ['PRB 2026-000002 · 25% · En SoluciónReducir reenvios de correo', 'PRB 2026-000005 · 10% · En MonitoreoTitulo PRB 2026-000005',
                     'PRB 2026-000006 · 0% · En SoluciónTitulo PRB 2026-000006'],
     'Ya comprometido por otras: 35%. Solo iniciativas activas.'], ab);
  Check('P1 % -> Tickets repinta y el detalle sigue abierto', [true, false, 'true'], A.repinta);
  Check('P2 Tickets -> % vuelve a la casilla del %', [false, true, false], A.vuelvePct);
  Check('D3 otro clic pliega', [true, 'false'], A.pliega);
  var w = A.angosto || {};
  Check('W1 en 360px: el indicador no ensancha la tabla (mismo desborde que sin el), queda en su celda y es de una linea', [true, true, true],
    [w.con === w.sin, w.dentro, w.alto > 0 && w.alto <= 22]);
  console.log('INFO  angosto: ' + JSON.stringify(w));
  console.log(fallos ? fallos + ' FALLO(S)' : 'TODO PASO');
  process.exit(fallos ? 1 : 0);
});
