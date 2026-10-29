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
//   N1     el encabezado dice cuantas categorias tiene LIGADAS la iniciativa
//          (las por agregar no), con nombre accesible y title.
//   I1-I4  el indicador: numero chico (boton, sin <select>) con cuantas
//          OTRAS iniciativas activas usan la categoria, pegado a la ruta, con
//          nombre accesible completo (cuantas y cuanto comprometen) y title;
//          sin otras activas no hay indicador; cerrado por omision.
//   M1-M3  % / Tickets: dos radios por fila (% de disminucion / Tickets a
//          resolver), mutuamente excluyentes, con legend accesible; cambiar
//          deja el foco en el radio elegido.
//   D1-D4  clic: abre el detalle (folio, %, estado, titulo, lo comprometido y
//          lo disponible) en la fila de JUSTO debajo, a todo el ancho;
//          aria-expanded; otro clic lo pliega; es enfocable con teclado.
//   P1-P2  cambiar % <-> Tickets repinta el bloque: el detalle abierto sigue
//          abierto y el selector % / Tickets sigue funcionando.
//   A1-A3  alineacion: la tabla mide lo que su contenido (no el 100% de la
//          caja), los % quedan cerca de la ruta, encabezado y celdas de "%
//          actual" alineados, y abrir el detalle no mueve las columnas.
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
      var nombre = b0 && b0.closest('.ini-cat-nombre'), bb0 = b0.getBoundingClientRect();
      var ruta0 = nombre.querySelector('.ini-cat-ruta').getBoundingClientRect();
      apunta('I', [!!b0, b0 && b0.tagName, !!nombre && nombre.firstChild.classList.contains('ini-cat-ruta'),
                   document.querySelectorAll('#regCambioGrupoPct select:not([data-cambio-modo])').length,
                   b0 && b0.querySelector('.ini-sr').textContent, b0 && b0.title, b0 && b0.getAttribute('aria-expanded'), b0 && b0.getAttribute('aria-controls'),
                   !!caja && caja.hidden, !!b1, !!$('regCambioOtras-l1'),
                   // Chica (<= 20px) y pegada a la ruta (<= 8px).
                   Math.round(bb0.width) <= 20 && Math.round(bb0.height) <= 20, Math.round(bb0.left - ruta0.right) <= 8,
                   b0.querySelector('[aria-hidden="true"]').textContent]);
      var th = document.querySelector('#regCambioGrupoPct thead th .ini-cats-cuantas');
      apunta('N', [th && th.querySelector('[aria-hidden="true"]').textContent, th && th.querySelector('.ini-sr').textContent, th && th.title]);
      var rs = document.querySelectorAll('input[type="radio"][name="regCambioModo-l0"]');
      var fs = rs[0] && rs[0].closest('fieldset');
      apunta('M', [rs.length, Array.prototype.map.call(rs, function (r) { return r.value + ':' + r.checked + ':' + r.parentNode.textContent.trim(); }),
                   fs && fs.querySelector('legend').textContent, document.querySelectorAll('select[data-cambio-modo]').length]);
      // A: alineacion, con el detalle cerrado, en una caja ancha (1100px): la
      // tabla no se estira al ancho de la caja.
      $('regCambioGrupoPct').style.width = '1100px';
      await espera(20);
      var tabla = document.querySelector('#regCambioGrupoPct table'), caja2 = document.querySelector('#regCambioGrupoPct .ini-det-tabla');
      var fila0 = b0.closest('tr'), tdAct = fila0.children[1], thAct = tabla.querySelector('thead th.num');
      var antes = Array.prototype.map.call(fila0.children, function (td) { return Math.round(td.getBoundingClientRect().left); });
      apunta('alinea', { tabla: Math.round(tabla.getBoundingClientRect().width), caja: Math.round(caja2.clientWidth),
                         hueco: Math.round(tdAct.getBoundingClientRect().left - nombre.getBoundingClientRect().right),
                         thDer: Math.round(thAct.getBoundingClientRect().right), tdDer: Math.round(tdAct.getBoundingClientRect().right) });
      $('regCambioGrupoPct').style.width = '';
      await espera(20);
      antes = Array.prototype.map.call(fila0.children, function (td) { return Math.round(td.getBoundingClientRect().left); });
      b0.focus();
      apunta('foco', document.activeElement === b0);
      clic(b0);
      await espera(20);
      apunta('abierto', [caja.hidden, b0.getAttribute('aria-expanded'),
                         Array.prototype.map.call(caja.querySelectorAll('li'), function (li) { return li.textContent; }),
                         caja.querySelector('small').textContent]);
      var despues = Array.prototype.map.call(fila0.children, function (td) { return Math.round(td.getBoundingClientRect().left); });
      apunta('fila', [caja.tagName, caja.previousElementSibling === fila0, caja.firstElementChild.getAttribute('colspan'),
                      JSON.stringify(antes) === JSON.stringify(despues)]);
      // P: cambiar a Tickets repinta el bloque (pintarCategoriasCambio).
      function radio(clave, valor) { return document.querySelector('input[data-cambio-modo="' + clave + '"][value="' + valor + '"]'); }
      radio('l0', 'tickets').focus();
      radio('l0', 'tickets').click();
      await espera(50);
      apunta('repinta', [!!document.querySelector('[data-cambio-tickets="l0"]'), $('regCambioOtras-l0').hidden,
                         boton('l0').getAttribute('aria-expanded')]);
      apunta('radios', [radio('l0', 'tickets').checked, radio('l0', 'pct').checked, document.activeElement === radio('l0', 'tickets')]);
      radio('l0', 'pct').click();
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
      // Los radios caben en su celda.
      var fsr = radio('l0', 'pct').closest('fieldset'), tdr = fsr.closest('td').getBoundingClientRect(), fr = fsr.getBoundingClientRect();
      apunta('radiosAngosto', fr.left >= tdr.left - 0.5 && fr.right <= tdr.right + 0.5);
      // La misma tabla sin indicadores: lo que ya desbordaba (la tabla tiene
      // su propio overflow-x) no es del indicador.
      Array.prototype.forEach.call(g.querySelectorAll('.ini-otras-check'), function (x) { x.style.display = 'none'; });
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
  Check('I1 indicador: <button> junto a la ruta, en el mismo bloque; ningun <select> nuevo en el bloque (solo los de % / Tickets)',
    [true, 'BUTTON', true, 0], i.slice(0, 4));
  Check('I2 numero visible = 3 OTRAS iniciativas (chico y pegado a la ruta); nombre accesible y title completos',
    [true, true, '3', '3 otras iniciativas activas en esta categoría (35% comprometido)',
     '3 otras iniciativas activas en esta categoría (35% comprometido): ver detalle'], [i[11], i[12], i[13], i[4], i[5]]);
  Check('N1 encabezado: 2 categorias ligadas a la iniciativa (no las 3 otras de la ruta B)',
    ['(2)', '2 categorías ligadas a esta iniciativa', '2 categorías ligadas a esta iniciativa'], A.N);
  Check('M1 dos radios por fila, % de disminucion marcado por omision; legend accesible; sin <select> de modo',
    [2, ['pct:true:% de disminución', 'tickets:false:Tickets a resolver'], 'Pedir ' + RUTA_B + ' por', 0], A.M);
  Check('M2 Tickets: excluyente (pct desmarcado) y el foco sigue en el radio elegido', [true, false, true], A.radios);
  Check('I3 cerrado por omision, controla su detalle', ['false', 'regCambioOtras-l0', true], [i[6], i[7], i[8]]);
  Check('I4 categoria sin otras activas: sin indicador ni detalle', [false, false], [i[9], i[10]]);
  var al = A.alinea || {};
  Check('A1 la tabla mide lo que su contenido, no el 100% de la caja', true, al.tabla < al.caja);
  Check('A2 "% actual" cerca de la ruta (<= 40px entre la ruta y su celda)', true, al.hueco >= 0 && al.hueco <= 40);
  Check('A3 encabezado y celda de "% actual" alineados a la derecha', al.thDer, al.tdDer);
  console.log('INFO  alineacion: ' + JSON.stringify(al));
  Check('D1 enfocable con teclado', true, A.foco);
  var ab = A.abierto || [];
  Check('D2 clic abre: aria-expanded, folio, %, estado, titulo; lo comprometido por otras',
    [false, 'true', ['PRB 2026-000002 · 25% · En SoluciónReducir reenvios de correo', 'PRB 2026-000005 · 10% · En MonitoreoTitulo PRB 2026-000005',
                     'PRB 2026-000006 · 0% · En SoluciónTitulo PRB 2026-000006'],
     'Ya comprometido por otras: 35%; disponible: 65% del tope de 100% por categoría. Solo iniciativas activas.'], ab);
  Check('D4 el detalle es la fila de justo debajo (colspan 4) y abrirlo no mueve las columnas', ['TR', true, '4', true], A.fila);
  Check('P1 % -> Tickets repinta y el detalle sigue abierto', [true, false, 'true'], A.repinta);
  Check('P2 Tickets -> % vuelve a la casilla del %', [false, true, false], A.vuelvePct);
  Check('D3 otro clic pliega', [true, 'false'], A.pliega);
  var w = A.angosto || {};
  Check('M3 en 360px los radios caben en su celda', true, A.radiosAngosto);
  Check('W1 en 360px: el indicador no ensancha la tabla (mismo desborde que sin el), queda en su celda y es de una linea', [true, true, true],
    [w.con === w.sin, w.dentro, w.alto > 0 && w.alto <= 22]);
  console.log('INFO  angosto: ' + JSON.stringify(w));
  console.log(fallos ? fallos + ' FALLO(S)' : 'TODO PASO');
  process.exit(fallos ? 1 : 0);
});
