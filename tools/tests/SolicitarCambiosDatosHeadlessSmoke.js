// tools/tests/SolicitarCambiosDatosHeadlessSmoke.js - "Solicitar cambios" de
// Titulo / Product Owner / Service Owner en un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco), con la pagina REAL
// admin/iniciativas.html y un fetch de mentira que hace de admin_sesion.ashx,
// del registro y de admin_iniciativas_solicitudes.ashx (guarda lo enviado).
//
// Es UX: la regla (nunca vacio) la prueban RegistroIniciativasSmoke.js (SX)
// y, en el servidor, SolicitudesCambioHttpSmoke.cs (G4*, G13b). Aqui:
//
//   K1-K6  PO / SO usan el desplegable del tablero (assets/js/desplegable.js,
//          como la categoria de Crear / Modificar): buscador, elegir, el
//          <select> real cambia y avisa; cerrar y volver a abrir el
//          formulario no duplica controles ni pierde eventos.
//   L1-L5  la casilla esta junto al nombre de SU dato (misma fila), con su
//          explicacion en gris; las tres tarjetas en columnas; el formulario
//          tiene ancho maximo y los botones son sticky.
//   E1-E2  envio real del formulario: solo lo marcado viaja; lo marcado y
//          vacio no sale del navegador.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\SolicitarCambiosDatosHeadlessSmoke.js   # sale 0 si todo paso
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

// Diez PO y diez SO: con 8 o mas opciones el desplegable trae buscador.
var POS = [], SOS = [];
for (var n = 1; n <= 10; n++) { POS.push('PO ' + (n < 10 ? '0' : '') + n); SOS.push('SO ' + (n < 10 ? '0' : '') + n); }

var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'], agrupadores: ['Problem'], fecha_gen: '01/10/2026',
  tipos_iniciativa: [{ prefijo: 'PRB', nombre: 'Problem' }],
  persistencia_solicitudes: true, solicitudes_datos: true,
  iniciativas: [{
    folio: 'PRB 2026-000001', titulo: 'Titulo actual', titulo_problem: 'Titulo actual', agrup: 'Problem', estado: 'En Análisis',
    tickets_reduce: 0, vol_reduce_folio: 0, riesgo_folio: 0, retrazado: 0, sem_fecha: 'ambar', fecha_retrasada: false,
    f_analisis: '2026-12-01', f_solucion: null, f_cierre: null, n_analisis: 0, n_solucion: 0, n_cierre: 0, antiguedad: 10,
    po: 'PO 01', so: 'SO 01', director: 'Dir A', manager: null, descripcion: 'Desc', observaciones: null,
    activa: true, seguimiento: true, sin_categoria: true, prefijo: 'PRB', f_creacion: '2026-01-10', categorias: [],
    po_capturado: 'PO 01', so_capturado: 'SO 01'
  }]
};

var ANTES = '<script>\n' +
  'window.__envios = [];\n' +
  'window.fetch = function (u, op) { u = String(u && u.url || u); var j = {};\n' +
  '  if (/admin_sesion\\.ashx/.test(u)) j = { autorizado: true, rol: "ADM", solicitante: true };\n' +
  '  else if (/admin_iniciativas_registro/.test(u)) j = ' + JSON.stringify(REGISTRO) + ';\n' +
  '  else if (/admin_iniciativas_solicitudes/.test(u)) { var c = {}; op.body.forEach(function (v, k) { c[k] = v; });\n' +
  '    window.__envios.push(c); j = { enviada: true, id_solicitud: window.__envios.length, repetida: false }; }\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 200,\n' +
  '    json: function () { return Promise.resolve(j); }, text: function () { return Promise.resolve(JSON.stringify(j)); } }); }, 10); }); };\n' +
  'Element.prototype.scrollIntoView = function () {};\n' +
  '</script>\n';

function sonda() {
  var R = [];
  var POS = window.__POS, SOS = window.__SOS;
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function apunta(caso, v) { R.push([caso, v]); }
  function $(id) { return document.getElementById(id); }
  function clic(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  function grupo() { return $('regCambioGrupoDatos'); }
  function abrirFormulario() {
    clic($('regCambioBoton'));
    var campo = $('regCambioCampo');
    campo.value = 'datos';
    campo.dispatchEvent(new Event('change', { bubbles: true }));
  }
  // Elige `valor` en el desplegable del dato `k` (po / so) como un usuario:
  // abrir, buscar, clic en la unica fila visible.
  function elegir(k, valor) {
    var dd = $('regCambioDatoValor-' + k).closest('.dd');
    clic(dd.querySelector('.dd-boton'));
    var abierto = dd.classList.contains('abierto');
    var busca = dd.querySelector('.dd-busca');
    busca.value = valor;
    busca.dispatchEvent(new Event('input', { bubbles: true }));
    var filas = Array.prototype.filter.call(dd.querySelectorAll('.dd-lista > li'), function (li) { return li.style.display !== 'none'; });
    if (filas.length === 1) clic(filas[0].querySelector('.dd-opcion'));
    return { abierto: abierto, buscador: busca.style.display !== 'none', filas: filas.length, cerrado: !dd.classList.contains('abierto'),
             valor: $('regCambioDatoValor-' + k).value, boton: dd.querySelector('.dd-valor').textContent };
  }
  function marcar(k, v) { var c = $('regCambioDato-' + k); if (c.checked !== v) clic(c); return c.checked; }
  function enviar(motivo) { $('regCambioMotivo').value = motivo; clic($('regCambioEnviar')); }
  (async function () {
    try {
      await espera(2500);
      var reg = window.IniciativasPagina.registro;
      reg.fijarDuenosCatalogo({ po: POS, so: SOS });
      reg.abrirDetalle('PRB 2026-000001');
      await espera(100);
      abrirFormulario();
      await espera(50);
      var g = grupo();
      apunta('dd', [g.querySelectorAll('.dd').length, g.querySelectorAll('select.ini-dd-categoria').length,
                    ['po', 'so'].map(function (k) { var s = $('regCambioDatoValor-' + k); return s.tagName + ':' + (s.getBoundingClientRect().width <= 1); })]);
      // L: la casilla junto al nombre de SU dato.
      apunta('tarjetas', Array.prototype.map.call(g.querySelectorAll('.ini-cambio-dato'), function (t) {
        var nombre = t.querySelector('.ini-cambio-dato-nombre').getBoundingClientRect();
        var casilla = t.querySelector('input[type="checkbox"]'), cr = casilla.getBoundingClientRect();
        var texto = t.querySelector('.ini-cambio-marca span');
        return { dato: t.getAttribute('data-dato'), nombre: t.querySelector('.ini-cambio-dato-nombre').textContent,
                 mismaFila: Math.abs((cr.top + cr.bottom) / 2 - (nombre.top + nombre.bottom) / 2) < 10,
                 cerca: cr.left - nombre.right >= 0 && cr.left - nombre.right < 40, ancho: Math.round(cr.width),
                 explica: texto.textContent, gris: getComputedStyle(texto).color, etiqueta: !!casilla.closest('label') };
      }));
      apunta('nombreColor', getComputedStyle(g.querySelector('.ini-cambio-dato-nombre')).color);
      apunta('columnas', getComputedStyle(g.querySelector('.ini-cambio-datos')).gridTemplateColumns.split(' ').length);
      apunta('layout', { anchoForm: $('regCambio').getBoundingClientRect().width, vista: document.documentElement.clientWidth,
                         pie: getComputedStyle(document.querySelector('#regCambio .ini-cambio-pie')).position,
                         altoDatos: Math.round(g.getBoundingClientRect().height) });
      // K: elegir con el desplegable.
      var cambios = 0;
      g.addEventListener('change', function () { cambios++; });
      apunta('elegirPo', elegir('po', 'PO 07'));
      apunta('elegirSo', elegir('so', 'SO 03'));
      apunta('cambios', cambios);
      // E1: solo PO y SO marcados; el titulo escrito sin marcar no viaja.
      $('regCambioDatoValor-titulo').value = 'escrito sin marcar';
      apunta('marcas', [marcar('po', true), marcar('so', true), marcar('titulo', false)]);
      enviar('Cambio de responsables');
      await espera(200);
      apunta('envio1', window.__envios.length ? window.__envios[0] : null);
      apunta('msg1', $('regCambioMsg').textContent);
      // Cerrar y volver a abrir: ni duplicados ni eventos perdidos.
      clic(document.querySelector('[data-accion="cambio-cancelar"]'));
      await espera(50);
      apunta('cerrado', [$('regCambio').hidden, document.querySelectorAll('#regCambio .dd').length]);
      abrirFormulario();
      await espera(50);
      clic($('regCambioBoton'));   // el boton alterna: cerrar...
      await espera(50);
      abrirFormulario();           // ...y abrir otra vez (tercera vez)
      await espera(50);
      g = grupo();
      apunta('reabierto', [document.querySelectorAll('#regCambio .dd').length, document.querySelectorAll('#regCambio .dd .dd .dd').length,
                           $('regCambioDatoValor-po').value, $('regCambioDato-po').checked]);
      apunta('elegirPo2', elegir('po', 'PO 09'));
      // E2: PO marcado y vacio + titulo valido: nada sale.
      marcar('titulo', true); $('regCambioDatoValor-titulo').value = 'Nuevo titulo';
      marcar('po', true);
      marcar('so', true);  // sin persona elegida
      enviar('Motivo');
      await espera(200);
      function borde(k) { return getComputedStyle($('regCambioDatoValor-' + k).closest('.dd').querySelector('.dd-boton')).borderTopColor; }
      apunta('envio2', [window.__envios.length, $('regCambioMsg').textContent, $('regCambioDatoValor-so').getAttribute('aria-invalid'),
                        borde('so') !== borde('po'), $('regCambioDatoValor-po').getAttribute('aria-invalid')]);
      // ...elegido el SO, sale con los tres.
      apunta('elegirSo2', elegir('so', 'SO 10'));
      enviar('Motivo');
      await espera(200);
      apunta('envio3', window.__envios.length > 1 ? window.__envios[1] : null);
    } catch (e) { apunta('error', String(e && e.stack || e)); }
    var pre = document.createElement('pre'); pre.id = '__res';
    pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  })();
}

var antes = ANTES + '<script>window.__POS = ' + JSON.stringify(POS) + '; window.__SOS = ' + JSON.stringify(SOS) + ';</script>\n';
var paginas = { '/admin/__cambios.html': Banco.pagina('admin/iniciativas.html', '../assets/js/sesion-admin.js', antes, sonda) };

Banco.correr(paginas, ['/admin/__cambios.html']).then(function (res) {
  var A = Banco.mapa(res[0]);
  if (A.error) console.log('ERROR en la sonda: ' + A.error);
  var GRIS = 'rgb(94, 94, 95)';   // --muted
  Check('K1 PO / SO: dos desplegables del tablero sobre <select> reales escondidos (como la categoria de Crear / Modificar)',
    [2, 2, ['SELECT:true', 'SELECT:true']], A.dd);
  Check('K2 elegir PO: abre, con buscador, filtra a una fila, elige y cierra; el <select> y el boton dicen la persona',
    { abierto: true, buscador: true, filas: 1, cerrado: true, valor: 'PO 07', boton: 'PO 07' }, A.elegirPo);
  Check('K3 elegir SO igual', { abierto: true, buscador: true, filas: 1, cerrado: true, valor: 'SO 03', boton: 'SO 03' }, A.elegirSo);
  Check('K4 cada eleccion avisa con change (el formulario la ve)', 2, A.cambios);
  Check('K5 Cancelar cierra y quita los controles; reabrir: dos desplegables, sin anidar, vacios y sin marcar',
    [[true, 0], [2, 0, '', false]], [A.cerrado, A.reabierto]);
  Check('K6 tras reabrir el desplegable sigue funcionando', { abierto: true, buscador: true, filas: 1, cerrado: true, valor: 'PO 09', boton: 'PO 09' },
    A.elegirPo2);
  var t = A.tarjetas || [];
  Check('L1 tres tarjetas: Título, Product Owner, Service Owner', ['titulo:Título', 'po:Product Owner', 'so:Service Owner'],
    t.map(function (x) { return x.dato + ':' + x.nombre; }));
  Check('L2 cada casilla en la MISMA fila que el nombre de su dato y pegada a el; tamano normal (no estirada)',
    [[true, true, 16], [true, true, 16], [true, true, 16]], t.map(function (x) { return [x.mismaFila, x.cerca, x.ancho]; }));
  Check('L3 explicacion junto a la casilla, en gris, dentro de su <label> (zona de clic)',
    [['Incluir cambios al título', GRIS, true], ['Incluir cambios al Product Owner', GRIS, true], ['Incluir cambios al Service Owner', GRIS, true]],
    t.map(function (x) { return [x.explica, x.gris, x.etiqueta]; }));
  Check('L4 el nombre del dato NO es gris (se distingue de la explicacion)', true, A.nombreColor !== GRIS);
  var l = A.layout || {};
  Check('L5 formulario con ancho maximo (<= 1180px), botones sticky', [true, 'sticky'], [l.anchoForm <= 1180, l.pie]);
  console.log('INFO  viewport ' + l.vista + 'px: ' + A.columnas + ' columna(s) de datos, alto del bloque de datos ' + l.altoDatos + 'px');
  Check('E1 envio: tipo datos, solo po_nuevo y so_nuevo (el titulo escrito sin marcar no viaja)',
    ['datos', 'PO 07', 'SO 03', false], [A.envio1 && A.envio1.tipo, A.envio1 && A.envio1.po_nuevo, A.envio1 && A.envio1.so_nuevo,
                                         !!A.envio1 && 'titulo_nuevo' in A.envio1]);
  Check('E1 ... dice enviada y que la aplica ADM', true, /Solicitud #1 enviada[\s\S]*administrador \(ADM\)/.test(A.msg1 || ''));
  Check('E2 SO marcado sin persona (PO y Titulo validos): no sale nada, error y solo el SO en rojo', [1, true, 'true', true, 'false'],
    A.envio2 ? [A.envio2[0], /Service Owner capturado: elige una persona de la lista; no puede quedar vacío/.test(A.envio2[1]), A.envio2[2],
                A.envio2[3], A.envio2[4]] : null);
  Check('E2 ... elegida la persona, sale con los tres', ['Nuevo titulo', 'PO 09', 'SO 10'],
    A.envio3 ? [A.envio3.titulo_nuevo, A.envio3.po_nuevo, A.envio3.so_nuevo] : null);
  console.log(fallos ? fallos + ' FALLO(S)' : 'TODO PASO');
  process.exit(fallos ? 1 : 0);
});
