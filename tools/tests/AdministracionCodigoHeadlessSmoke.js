// tools/tests/AdministracionCodigoHeadlessSmoke.js - pestaña Administracion >
// Cambios recientes: el Codigo abre el detalle de la iniciativa AQUI, sin
// cambiar de pestaña (Iniciativas.abrirIniciativaAqui -> abrirDesdeLista),
// en un Chrome de verdad (tools/tests/BancoHeadless.js; no escribe en disco)
// con la pagina REAL admin/iniciativas.html y un fetch de mentira (sesion
// ADM, registro y cambios recientes).
//
//   A1-A3   ADM abre Administracion: Cambios recientes con el Codigo de cada
//           fila del registro como boton y SIN boton "Ver" ni columna "Abrir".
//   C1-C3   clic en el Codigo de PRB 2026-000002: se abre #regDetalle con ESE
//           folio; tab-administracion sigue seleccionada y su panel visible;
//           panel-iniciativas sigue oculto.
//   F1-F2   cerrar el detalle: se sigue en Administracion y el foco vuelve
//           al MISMO boton del Codigo que lo abrio.
//   U1-U4   con cambios sin guardar en el detalle abierto, el Codigo de otra
//           fila pide la confirmacion de siempre (window.confirm, el mensaje
//           de soltarCambios): Cancelar deja abierto el mismo detalle con sus
//           cambios; Aceptar descarta y abre el otro, sin salir de
//           Administracion.
//   N1      un folio que no esta en el registro no es boton (no se abre).
//
// window.confirm se sustituye solo para CONTESTAR la pregunta (un dialogo de
// verdad bloquea Chrome headless); la pregunta la sigue haciendo
// VistaRegistro.soltarCambios por su camino de siempre.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\AdministracionCodigoHeadlessSmoke.js   # sale 0 si todo paso
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

function ini(folio, titulo) {
  return {
    folio: folio, titulo: titulo, titulo_problem: titulo, agrup: 'Problem', estado: 'En Análisis',
    tickets_reduce: 0, vol_reduce_folio: 0, riesgo_folio: 0, retrazado: 0, sem_fecha: 'ambar', fecha_retrasada: false,
    f_analisis: '2026-12-01', f_solucion: null, f_cierre: null, n_analisis: 0, n_solucion: 0, n_cierre: 0, antiguedad: 10,
    po: 'PO 01', so: 'SO 01', director: 'Dir A', manager: null, descripcion: 'Desc', observaciones: 'Obs',
    activa: true, seguimiento: true, sin_categoria: true, prefijo: 'PRB', f_creacion: '2026-01-10',
    po_capturado: 'PO 01', so_capturado: 'SO 01', categorias: []
  };
}

var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'], agrupadores: ['Problem'], fecha_gen: '01/10/2026',
  tipos_iniciativa: [{ prefijo: 'PRB', nombre: 'Problem' }],
  estados_problem: ['En Análisis', 'En Solución', 'En Monitoreo', 'Detenido', 'Cerrado'],
  persistencia_admin: true,
  iniciativas: [ini('PRB 2026-000001', 'Uno'), ini('PRB 2026-000002', 'Dos'), ini('PRB 2026-000003', 'Tres')]
};
var RECIENTES = {
  estado: 'ok', limite: 10, cambios: [
    { folio: 'PRB 2026-000002', fecha_utc: '2026-10-20T16:05:00Z', usuario: 'SORIANA\\t_adm', accion: 'cambio' },
    { folio: 'PRB 2026-000099', fecha_utc: '2026-10-20T15:00:00Z', usuario: 'SORIANA\\t_adm', accion: 'cambio' },
    { folio: 'PRB 2026-000003', fecha_utc: '2026-10-19T12:00:00Z', usuario: 'SORIANA\\t_adm', accion: 'alta' }
  ]
};

var ANTES = '<script>\n' +
  'window.__confirmar = []; window.__respuesta = false;\n' +
  'window.confirm = function (m) { window.__confirmar.push(String(m)); return window.__respuesta; };\n' +
  'window.fetch = function (u, op) { u = String(u && u.url || u); var j = {};\n' +
  '  if (/admin_sesion\\.ashx/.test(u)) j = { autorizado: true, rol: "ADM", solicitante: true };\n' +
  '  else if (/admin_iniciativas_registro/.test(u)) j = ' + JSON.stringify(REGISTRO) + ';\n' +
  '  else if (/admin_iniciativas_recientes/.test(u)) j = ' + JSON.stringify(RECIENTES) + ';\n' +
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
  function pestana() {
    return { tab: $('tab-administracion').getAttribute('aria-selected'), tabIni: $('tab-iniciativas').getAttribute('aria-selected'),
             admVisible: !$('panel-administracion').hidden, iniVisible: !$('panel-iniciativas').hidden };
  }
  function codigo(folio) { return document.querySelector('#crLista [data-cr-folio="' + folio + '"]'); }
  (async function () {
    try {
      await espera(2500);
      var reg = window.IniciativasPagina.registro;
      clic($('tab-administracion'));
      await espera(300);
      var lista = $('crLista');
      apunta('a', [!lista.hidden, !!codigo('PRB 2026-000002'), codigo('PRB 2026-000002') && codigo('PRB 2026-000002').className,
        (lista.innerHTML.match(/>Ver</g) || []).length, /<span class="ini-sr">Abrir<\/span>/.test(lista.innerHTML),
        lista.querySelectorAll('[data-cr-folio]').length, !!codigo('PRB 2026-000099'), pestana()]);

      // ---- Codigo -> detalle, sin cambiar de pestaña ----
      var b2 = codigo('PRB 2026-000002');
      b2.focus();
      clic(b2);
      await espera(100);
      apunta('c', [!$('regDetalle').hidden, $('regDetTitulo').textContent, reg.abierta, pestana(), window.__confirmar.length]);

      // ---- cerrar: misma pestaña, foco al MISMO boton ----
      clic($('regDetCerrar'));
      await espera(100);
      var activo = document.activeElement;
      apunta('f', [$('regDetalle').hidden, pestana(), activo === b2, activo && activo.getAttribute('data-cr-folio')]);

      // ---- cambios sin guardar ----
      b2 = codigo('PRB 2026-000002');
      clic(b2);
      await espera(100);
      var editar = document.querySelector('#regDetalle [data-accion="editar-admin"]');
      if (editar) { clic(editar); await espera(100); }
      // El primer texto editable del detalle (Titulo): si se muestra como
      // boton, se abre su casilla; luego se escribe como lo haria ADM.
      var campo = document.querySelector('#regDetalle [data-edicion="titulo"]') || document.querySelector('#regDetalle [data-edicion]');
      var clave = campo && campo.getAttribute('data-edicion');
      if (campo && campo.tagName !== 'INPUT' && campo.tagName !== 'TEXTAREA') {
        clic(campo); await espera(50);
        campo = document.querySelector('#regDetalle input[data-edicion="' + clave + '"], #regDetalle textarea[data-edicion="' + clave + '"]') || campo;
      }
      if (campo && 'value' in campo) {
        campo.value = 'Titulo editado sin guardar';
        campo.dispatchEvent(new Event('input', { bubbles: true }));
        campo.dispatchEvent(new Event('change', { bubbles: true }));
      }
      await espera(50);
      apunta('u0', [!!editar, clave, !!(campo && 'value' in campo), reg.hayCambiosSinGuardar()]);

      // Cancelar: sigue el mismo detalle, con sus cambios.
      window.__respuesta = false;
      clic(codigo('PRB 2026-000003'));
      await espera(100);
      apunta('u1', [window.__confirmar.length, window.__confirmar[0] || '', reg.abierta, $('regDetTitulo').textContent,
        reg.hayCambiosSinGuardar(), pestana()]);

      // Aceptar: descarta y abre el otro, sin salir de Administracion.
      window.__respuesta = true;
      var b3 = codigo('PRB 2026-000003');
      clic(b3);
      await espera(100);
      apunta('u2', [window.__confirmar.length, reg.abierta, $('regDetTitulo').textContent, reg.hayCambiosSinGuardar(), pestana()]);
      clic($('regDetCerrar'));
      await espera(100);
      apunta('u3', [$('regDetalle').hidden, pestana(), document.activeElement === b3]);
    } catch (e) { apunta('error', String(e && e.stack || e)); }
    var pre = document.createElement('pre'); pre.id = '__res';
    pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  })();
}

var paginas = { '/admin/__admcodigo.html': Banco.pagina('admin/iniciativas.html', '../assets/js/sesion-admin.js', ANTES, sonda) };

Banco.correr(paginas, ['/admin/__admcodigo.html']).then(function (res) {
  var A = Banco.mapa(res[0]);
  if (A.error) console.log('ERROR en la sonda: ' + A.error);
  var EN_ADM = { tab: 'true', tabIni: 'false', admVisible: true, iniVisible: false };
  var a = A.a || [];
  Check('A1 Administracion: Cambios recientes visible, el Codigo de PRB 2026-000002 es boton (ini-folio)', [true, true, 'ini-folio'], a.slice(0, 3));
  Check('A2 sin boton "Ver" ni columna "Abrir"; un boton por fila del registro (2 de 3); el que no esta, sin boton', [0, false, 2, false], a.slice(3, 7));
  Check('A3 la pestaña seleccionada es Administracion', EN_ADM, a[7]);
  Check('C1 el Codigo abre el detalle de ESA iniciativa', [true, 'PRB 2026-000002', 'PRB 2026-000002'], (A.c || []).slice(0, 3));
  Check('C2 sigue en Administracion (tab-administracion seleccionada, Iniciativas oculta)', EN_ADM, (A.c || [])[3]);
  Check('C3 sin cambios: no pregunta nada', 0, (A.c || [])[4]);
  Check('F1 cerrar el detalle: se queda en Administracion', [true, EN_ADM], (A.f || []).slice(0, 2));
  Check('F2 el foco vuelve al MISMO boton del Codigo', [true, 'PRB 2026-000002'], (A.f || []).slice(2, 4));
  Check('U0 en el detalle se escribe un cambio sin guardar (Titulo)', true, (A.u0 || [])[3]);
  var u1 = A.u1 || [];
  Check('U1 Codigo de otra con cambios sin guardar: la confirmacion de siempre', [1, 'Hay 1 cambio sin guardar en PRB 2026-000002. ¿Descartarlos?'], u1.slice(0, 2));
  Check('U2 Cancelar: sigue el mismo detalle, con sus cambios, en Administracion', ['PRB 2026-000002', 'PRB 2026-000002', true, EN_ADM], u1.slice(2, 6));
  Check('U3 Aceptar: descarta y abre el otro, en Administracion', [2, 'PRB 2026-000003', 'PRB 2026-000003', false, EN_ADM], A.u2);
  Check('U4 cerrarlo: Administracion y foco a su Codigo', [true, EN_ADM, true], A.u3);
  Check('N1 PRB 2026-000099 (fuera del registro): sin boton', false, a[6]);
  if (fallos) console.log('sonda u0: ' + JSON.stringify(A.u0));
  console.log(fallos ? fallos + ' FALLO(S)' : 'TODO PASO');
  process.exit(fallos ? 1 : 0);
});
