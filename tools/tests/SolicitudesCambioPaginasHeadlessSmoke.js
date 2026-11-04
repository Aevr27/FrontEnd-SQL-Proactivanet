// tools/tests/SolicitudesCambioPaginasHeadlessSmoke.js - Solicitudes ->
// Cambios en un Chrome de verdad (tools/tests/BancoHeadless.js; no escribe en
// disco), con la pagina REAL admin/iniciativas.html y un fetch de mentira
// para admin_sesion.ashx, el registro y admin_iniciativas_solicitudes.ashx.
//
//   X1-X6  el detalle de siempre (#solDetalle, htmlDetalle) se expande en la
//          fila de abajo de SU solicitud, dentro de la tabla; una sola a la
//          vez; Cerrar y el chevron lo pliegan; Aplicar sigue funcionando
//          dentro de la tabla (POST con el comentario escrito ahi).
//   G1-G5  20 por pagina, "<" / ">" con sus limites, cambiar de pagina o de
//          filtro pliega el detalle; el filtro vuelve a la pagina 1.
//
//   node tools\tests\SolicitudesCambioPaginasHeadlessSmoke.js   # sale 0 si todo paso
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

var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'], agrupadores: ['Problem'], fecha_gen: '01/10/2026',
  tipos_iniciativa: [{ prefijo: 'PRB', nombre: 'Problem' }], persistencia_solicitudes: true, iniciativas: []
};

var ANTES = '<script>\n' +
  'window.__posts = [];\n' +
  'function __sol(id, estado) { return { id: id, folio: "PRB 2026-" + ("00000" + id).slice(-6), titulo: "Ini " + id, tipo: "ESTADO", estado: estado,\n' +
  '  estado_anterior: "En Solución", estado_nuevo: "En Monitoreo", subestado_anterior: null, subestado_nuevo: null, campo_fecha: null,\n' +
  '  motivo: "Motivo " + id, solicitado_por: "SORIANA\\\\t_mod", solicitante_nombre: "Persona " + id, rol_solicitante: "MOD",\n' +
  '  fecha_solicitud_utc: "2026-10-19T16:00:00Z", intentos: 0, ultimo_error: null, categorias: 0, sin_clasificar: 0, desactualizada: false,\n' +
  '  actual: { estado: "En Solución" }, categorias_detalle: [], revisado_por: estado === "PENDIENTE" ? null : "SORIANA\\\\t_adm",\n' +
  '  fecha_revision_utc: estado === "PENDIENTE" ? null : "2026-10-20T10:00:00Z",\n' +
  '  eventos: [{ id: 1, evento: "ENVIADA", usuario: "SORIANA\\\\t_mod", fecha_utc: "2026-10-19T16:00:00Z", detalle: null },\n' +
  '            { id: 2, evento: "DESACTUALIZADA", usuario: "SORIANA\\\\t_adm", fecha_utc: "2026-10-19T17:00:00Z", detalle: null }] }; }\n' +
  'window.__aplicadas = {};\n' +
  'function __estado(id) { return id > 100 || window.__aplicadas[id] ? "APLICADA" : "PENDIENTE"; }\n' +
  'window.fetch = function (u, op) { u = String(u && u.url || u); var j = {};\n' +
  '  if (/admin_sesion\\.ashx/.test(u)) j = { autorizado: true, rol: "ADM", solicitante: true };\n' +
  '  else if (/admin_iniciativas_registro/.test(u)) j = ' + JSON.stringify(REGISTRO) + ';\n' +
  '  else if (/admin_iniciativas_solicitudes\\.ashx\\?accion=listar/.test(u)) { var e = (/estado=(\\w+)/.exec(u) || [])[1] || "", l = [];\n' +
  '    for (var i = 1; i <= 45; i++) if (!e || __estado(i) === e) l.push(__sol(i, __estado(i)));\n' +
  '    for (var k = 101; k <= 103; k++) if (!e || e === "APLICADA") l.push(__sol(k, "APLICADA"));\n' +
  '    j = { solicitudes: l }; }\n' +
  '  else if (/admin_iniciativas_solicitudes\\.ashx\\?accion=detalle/.test(u)) { var id = Number(/id=(\\d+)/.exec(u)[1]); j = __sol(id, __estado(id)); }\n' +
  '  else if (/admin_iniciativas_solicitudes\\.ashx\\?accion=aplicar/.test(u)) { var c = {}; op.body.forEach(function (v, k) { c[k] = v; });\n' +
  '    window.__posts.push(c); window.__aplicadas[c.id] = true; j = { aplicada: true, id_solicitud: Number(c.id) }; }\n' +
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
  function filas() { return Array.prototype.map.call(document.querySelectorAll('#solLista tr.ini-sol-fila'), function (tr) { return Number(tr.getAttribute('data-sol-id')); }); }
  function chev(id) { return document.querySelector('#solLista [data-sol-exp="' + id + '"]'); }
  function boton(d) { return document.querySelector('#solPaginas [data-sol-pagina="' + d + '"]'); }
  function pagina() { var s = document.querySelector('#solPaginas .ini-sol-pagina'); return s ? s.textContent : ''; }
  // Donde esta el detalle: la fila anterior a la suya (id) o "fuera".
  function ubicacion() {
    var caja = $('solDetalle'), tr = caja.closest('tr.ini-sol-exp');
    if (!tr) return caja.parentNode === $('solCola') ? 'fuera' : 'otro';
    var prev = tr.previousElementSibling;
    return { despuesDe: prev ? Number(prev.getAttribute('data-sol-id')) : null, colspan: tr.firstElementChild.colSpan,
             columnas: prev ? prev.children.length : 0, enTabla: !!tr.closest('table.ini-sol-tabla') };
  }
  function expandidas() { return document.querySelectorAll('#solLista tr.ini-sol-exp').length; }
  (async function () {
    try {
      await espera(2000);
      clic($('tab-solicitudes'));
      await espera(300);
      apunta('inicio', { filas: filas().length, primera: filas()[0], ultima: filas()[19], pagina: pagina(),
                         antDis: boton(-1).disabled, sigDis: boton(1).disabled, chevrones: document.querySelectorAll('#solLista .ini-sol-chev').length });
      clic(chev(5));
      await espera(200);
      var caja = $('solDetalle');
      apunta('expandir', { ubic: ubicacion(), visible: !caja.hidden && caja.getBoundingClientRect().height > 50,
                           texto: ['Solicitud #5', 'Persona 5', 'MOD', 'Al enviar', 'Pedido', 'Ahora', 'Motivo 5', 'Historial de la solicitud', 'Enviada', 'Desactualizada']
                             .filter(function (t) { return caja.textContent.indexOf(t) < 0; }),
                           fondo: getComputedStyle(caja).backgroundColor, aria: chev(5).getAttribute('aria-expanded') });
      clic(document.querySelector('#solLista tr.ini-sol-fila[data-sol-id="9"] td:nth-child(4)'));
      await espera(200);
      apunta('otra', { ubic: ubicacion(), n: expandidas(), titulo: /Solicitud #9 /.test($('solDetalle').textContent),
                       aria5: chev(5).getAttribute('aria-expanded'), aria9: chev(9).getAttribute('aria-expanded') });
      // Clic dentro del detalle (el motivo) no pliega ni abre nada.
      clic($('solDetalle').querySelector('.ini-texto'));
      await espera(100);
      apunta('dentro', [expandidas(), !$('solDetalle').hidden]);
      clic($('solDetalle').querySelector('[data-sol-accion="cerrar"]'));
      await espera(100);
      apunta('cerrar', { n: expandidas(), oculto: $('solDetalle').hidden, ubic: ubicacion(), aria9: chev(9).getAttribute('aria-expanded') });
      clic(chev(9)); await espera(200);
      clic(chev(9)); await espera(100);
      apunta('chevron', [expandidas(), $('solDetalle').hidden]);
      // Aplicar desde la fila expandida: comentario escrito ahi, POST, mensaje.
      clic(chev(3)); await espera(200);
      $('solComentario').value = 'ok desde la tabla';
      clic($('solDetalle').querySelector('[data-sol-accion="aplicar"]'));
      await espera(400);
      apunta('aplicar', { post: window.__posts[0] || null, msg: $('solDetMsg') ? $('solDetMsg').textContent : null,
                          ubic: ubicacion(), visible: !$('solDetalle').hidden, enLista: filas().indexOf(3) >= 0, filas: filas().length });
      clic($('solDetalle').querySelector('[data-sol-accion="cerrar"]'));
      await espera(100);
      // Paginas (44 pendientes: 20 + 20 + 4).
      clic(chev(7)); await espera(200);
      clic(boton(1)); await espera(100);
      apunta('pag2', { pagina: pagina(), primera: filas()[0], n: filas().length, exp: expandidas(), oculto: $('solDetalle').hidden });
      clic(boton(1)); await espera(100);
      apunta('pag3', { pagina: pagina(), filas: filas(), sigDis: boton(1).disabled, antDis: boton(-1).disabled });
      clic(boton(-1)); await espera(50); clic(boton(-1)); await espera(50);
      apunta('volver', { pagina: pagina(), exp: expandidas(), aria: document.querySelectorAll('#solLista [aria-expanded="true"]').length });
      clic(boton(1)); await espera(50);
      var f = $('solFiltro'); f.value = ''; f.dispatchEvent(new Event('change', { bubbles: true }));
      await espera(300);
      apunta('todas', { pagina: pagina(), n: filas().length, primera: filas()[0] });
      f.value = 'APLICADA'; f.dispatchEvent(new Event('change', { bubbles: true }));
      await espera(300);
      apunta('aplicadas', { pagina: pagina(), filas: filas(), antDis: boton(-1).disabled, sigDis: boton(1).disabled });
      f.value = 'RECHAZADA'; f.dispatchEvent(new Event('change', { bubbles: true }));
      await espera(300);
      apunta('cero', { lista: $('solLista').textContent.trim(), pags: $('solPaginas').innerHTML });
    } catch (e) { apunta('error', String(e && e.stack || e)); }
    var pre = document.createElement('pre'); pre.id = '__res';
    pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  })();
}

var paginas = { '/admin/__cambiospag.html': Banco.pagina('admin/iniciativas.html', '../assets/js/sesion-admin.js', ANTES, sonda) };

Banco.correr(paginas, ['/admin/__cambiospag.html']).then(function (res) {
  var A = Banco.mapa(res[0]);
  if (!res[0]) console.log('ERROR sin resultado de la sonda');
  if (A.error) console.log('ERROR en la sonda: ' + A.error);
  Check('G1 pagina 1: 20 filas (1..20), "Página 1 de 3", "<" deshabilitado, ">" no; un chevron por fila',
    { filas: 20, primera: 1, ultima: 20, pagina: 'Página 1 de 3', antDis: true, sigDis: false, chevrones: 20 }, A.inicio);
  var x = A.expandir || {};
  Check('X1 expandir #5: detalle en la fila de abajo, dentro de la tabla, ocupa todas las columnas',
    { despuesDe: 5, colspan: 8, columnas: 8, enTabla: true }, x.ubic);
  Check('X1 ...visible, con todo el detalle de siempre (solicitante, rol, Al enviar / Pedido / Ahora, motivo, historial)',
    [true, [], 'true'], [x.visible, x.texto, x.aria]);
  Check('X1 ...fondo verde de siempre (.ini-cambio, --g-50)', true, !!x.fondo && x.fondo !== 'rgba(0, 0, 0, 0)');
  Check('X2 expandir otra (clic en la fila): una sola abierta, debajo de la #9',
    { ubic: { despuesDe: 9, colspan: 8, columnas: 8, enTabla: true }, n: 1, titulo: true, aria5: 'false', aria9: 'true' }, A.otra);
  Check('X3 clic dentro del detalle no lo pliega', [1, true], A.dentro);
  Check('X4 Cerrar: pliega, el detalle vuelve fuera de la tabla, chevron cerrado', { n: 0, oculto: true, ubic: 'fuera', aria9: 'false' }, A.cerrar);
  Check('X5 el chevron abre y vuelve a plegar', [0, true], A.chevron);
  var ap = A.aplicar || {};
  Check('X6 Aplicar dentro de la tabla: POST con id y comentario; dice aplicada', ['3', 'ok desde la tabla', true],
    [ap.post && ap.post.id, ap.post && ap.post.comentario, /Solicitud #3 aplicada/.test(ap.msg || '')]);
  Check('X6 ...ya no es pendiente: sale de la lista y el resultado queda visible fuera de la tabla', ['fuera', true, false, 20],
    [ap.ubic, ap.visible, ap.enLista, ap.filas]);
  Check('G2 ">" : pagina 2 (21..40) y el detalle abierto se pliega', { pagina: 'Página 2 de 3', primera: 22, n: 20, exp: 0, oculto: true }, A.pag2);
  Check('G3 ultima pagina parcial: 4 filas, ">" deshabilitado', { pagina: 'Página 3 de 3', filas: [42, 43, 44, 45], sigDis: true, antDis: false }, A.pag3);
  Check('G4 volver a la pagina 1: sin detalle viejo', { pagina: 'Página 1 de 3', exp: 0, aria: 0 }, A.volver);
  Check('G5 filtro "Todas" (48 = 44 pendientes + 4 aplicadas): vuelve a la pagina 1 de 3',
    { pagina: 'Página 1 de 3', n: 20, primera: 1 }, A.todas);
  Check('G5 filtro Aplicadas: toda la coleccion filtrada (4), pagina 1 de 1, ambas flechas deshabilitadas',
    { pagina: 'Página 1 de 1', filas: [3, 101, 102, 103], antDis: true, sigDis: true }, A.aplicadas);
  Check('G5 cero resultados: el aviso de siempre, sin controles', { lista: 'No hay solicitudes con ese estado.', pags: '' }, A.cero);
  console.log(fallos ? fallos + ' FALLO(S)' : 'TODO PASO');
  process.exit(fallos ? 1 : 0);
});
