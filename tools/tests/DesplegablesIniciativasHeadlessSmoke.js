// tools/tests/DesplegablesIniciativasHeadlessSmoke.js - los selectores de
// Iniciativas con el desplegable del filtro Tecnicos de SLA
// (assets/js/desplegable.js) en un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco), con la pagina REAL
// admin/iniciativas.html y un fetch de mentira (sesion ADM, catalogo y
// registro).
//
// Es UX: las reglas (cascada, resolver, rechazar lo que no es opcion) las
// prueban IniciativaAdminSmoke.js, IniciativasCascadaSmoke.js y
// RegistroIniciativasSmoke.js. Aqui:
//
//   N1-N5  Nueva solicitud: Tipo / PO / SO / Categoria son el desplegable;
//          elegir PO rehace las filas de SO con la cascada (sin filas
//          viejas); deshabilitado el <select>, el boton tambien.
//   C1-C5  Crear: PO / SO son el desplegable (ya no <datalist>); el buscador
//          filtra, elegir llega al borrador; lo escrito en el buscador no
//          elige nada; repintar no duplica controles.
//   M1-M2  Modificar (ADM): Service Owner es el desplegable y elegir llega
//          al borrador de la edicion.
//   S1-S4  Solicitar cambios: categoria y Estado son el desplegable; elegir
//          + Agregar suma la categoria; reabrir no duplica.
//   G1     Seguimiento: la categoria es el desplegable.
//   V1     el menu es el de SLA: blanco, redondeado, fijo (no lo recorta la
//          tarjeta), con buscador.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\DesplegablesIniciativasHeadlessSmoke.js   # sale 0 si todo paso
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

function dos(n) { return (n < 10 ? '0' : '') + n; }

// 25 rutas: 5 PO con 5 SO cada uno (SO NN distintos), una categoria por ruta.
var RUTAS = [];
for (var n = 1; n <= 25; n++) {
  RUTAS.push({ director: 'Dir A', po: 'PO ' + dos(Math.ceil(n / 5)), so: 'SO ' + dos(n), categoria: '/A/Cat ' + dos(n) });
}
var CATALOGO = { tipos: [{ prefijo: 'PRB', nombre: 'Problem' }], tipo_problem: 'PRB', rutas: RUTAS,
  rutas_sin_duenos: 0, rutas_duenos_no_vigentes: 0 };
var POS = [], SOS = [];
for (var k = 1; k <= 25; k++) { if (k <= 5) POS.push('PO ' + dos(k)); SOS.push('SO ' + dos(k)); }
var ESTADOS = ['En Análisis', 'En Solución', 'En Monitoreo', 'Cerrado', 'Cancelado', 'Pausado', 'Escalado', 'En Revisión', 'Reabierto'];

var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'], agrupadores: ['Problem'], fecha_gen: '01/10/2026',
  tipos_iniciativa: [{ prefijo: 'PRB', nombre: 'Problem' }], estados_problem: ESTADOS,
  persistencia_solicitudes: true, solicitudes_datos: true, edicion_duenos_quitar: true,
  iniciativas: [{
    folio: 'PRB 2026-000001', titulo: 'Titulo actual', titulo_problem: 'Titulo actual', agrup: 'Problem', estado: 'En Análisis',
    tickets_reduce: 0, vol_reduce_folio: 0, riesgo_folio: 0, retrazado: 0, sem_fecha: 'ambar', fecha_retrasada: false,
    f_analisis: '2026-12-01', f_solucion: null, f_cierre: null, n_analisis: 0, n_solucion: 0, n_cierre: 0, antiguedad: 10,
    po: 'PO 01', so: 'SO 01', director: 'Dir A', manager: null, descripcion: 'Desc', observaciones: null,
    activa: true, seguimiento: true, sin_categoria: false, prefijo: 'PRB', f_creacion: '2026-01-10',
    categorias: [{ categoria: '/A/Cat 01', pct_dism: 0.5, tickets_reduce: 3, director: 'Dir A', po: 'PO 01', so: 'SO 01' },
                 { categoria: '/A/Cat 02', pct_dism: 0.2, tickets_reduce: 1, director: 'Dir A', po: 'PO 01', so: 'SO 02' }],
    po_capturado: 'PO 01', so_capturado: 'SO 01'
  }]
};

var ANTES = '<script>\n' +
  'window.fetch = function (u) { u = String(u && u.url || u); var j = {};\n' +
  '  if (/admin_sesion\\.ashx/.test(u)) j = { autorizado: true, rol: "ADM", solicitante: true };\n' +
  '  else if (/admin_iniciativas_catalogos/.test(u)) j = ' + JSON.stringify(CATALOGO) + ';\n' +
  '  else if (/admin_iniciativas_registro/.test(u)) j = ' + JSON.stringify(REGISTRO) + ';\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 200,\n' +
  '    json: function () { return Promise.resolve(j); }, text: function () { return Promise.resolve(JSON.stringify(j)); } }); }, 10); }); };\n' +
  'Element.prototype.scrollIntoView = function () {};\n' +
  'window.__POS = ' + JSON.stringify(POS) + '; window.__SOS = ' + JSON.stringify(SOS) + ';\n' +
  '</script>\n';

function sonda() {
  var R = [];
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function apunta(caso, v) { R.push([caso, v]); }
  function $(id) { return document.getElementById(id); }
  function clic(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  function dd(id) { var s = $(id); return s && s.closest ? s.closest('.dd') : null; }
  function visibles(d) {
    return Array.prototype.filter.call(d.querySelectorAll('.dd-lista > li'), function (li) {
      return li.style.display !== 'none' && li.querySelector('.dd-opcion');
    });
  }
  // Montado: el <select> real dentro de UN .dd (sin anidar) y escondido.
  function montado(id) {
    var s = $(id), d = dd(id);
    return !!(s && s.tagName === 'SELECT' && d && !d.parentNode.closest('.dd') && s.getBoundingClientRect().width <= 1 &&
      d.querySelector('.dd-boton'));
  }
  function abrir(id) { var d = dd(id); if (!d.classList.contains('abierto')) clic(d.querySelector('.dd-boton')); return d; }
  function buscar(id, texto) {
    var d = abrir(id), b = d.querySelector('.dd-busca');
    b.value = texto;
    b.dispatchEvent(new Event('input', { bubbles: true }));
    return d;
  }
  // Como un usuario: abrir, buscar, clic en la unica fila visible.
  function elegir(id, texto) {
    var d = buscar(id, texto), f = visibles(d);
    if (f.length === 1) clic(f[0].querySelector('.dd-opcion'));
    return { filas: f.length, cerrado: !d.classList.contains('abierto'), valor: $(id).value,
             boton: d.querySelector('.dd-valor').textContent };
  }
  function filasTexto(id) {
    var d = dd(id);
    return Array.prototype.map.call(d.querySelectorAll('.dd-opcion'), function (f) { return f.textContent; });
  }
  function opcionesTexto(id) { return Array.prototype.map.call($(id).options, function (o) { return o.text; }); }
  (async function () {
    try {
      await espera(2500);
      var pg = window.IniciativasPagina;

      // ---- N: Nueva solicitud ----
      pg.mostrarVista('nueva');
      await espera(100);
      apunta('N1', ['selTipo', 'selPo', 'selSo', 'selCategoria'].map(montado));
      apunta('N1b', $('selSo').disabled === dd('selSo').querySelector('.dd-boton').disabled);
      apunta('N2', elegir('selTipo', 'Problem'));
      await espera(50);
      apunta('N3', elegir('selPo', 'PO 02'));
      await espera(50);
      // La cascada rehizo las opciones de SO: el menu muestra EXACTAMENTE las
      // del <select>, las de PO 02 (SO 06..10), sin filas viejas.
      apunta('N4', [JSON.stringify(filasTexto('selSo')) === JSON.stringify(opcionesTexto('selSo')),
                    filasTexto('selSo').filter(function (t) { return /^SO /.test(t); })]);
      apunta('N5', elegir('selSo', 'SO 07'));
      await espera(50);

      // ---- C: Crear (ADM) ----
      pg.mostrarVista('crear');
      await espera(100);
      var v = pg.crearAdmin;
      apunta('C1', [montado('admPo'), montado('admSo'), !!document.querySelector('#admPoSelector datalist, #admSoSelector datalist, #admPoSelector input:not(.dd-busca), #admSoSelector input:not(.dd-busca)')]);
      var d = buscar('admSo', 'so 1');
      apunta('C2', [d.querySelector('.dd-busca').style.display !== 'none', visibles(d).map(function (li) { return li.textContent; })]);
      // Lo escrito en el buscador no es una eleccion: Escape cierra sin elegir.
      buscar('admSo', 'Persona inventada');
      var vis = visibles(dd('admSo')).length;
      dd('admSo').querySelector('.dd-busca').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      dd('admSo').querySelector('.dd-busca').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      apunta('C3', [vis, $('admSo').value, v.borrador.duenos.so, dd('admSo').classList.contains('abierto')]);
      apunta('C4', [elegir('admSo', 'SO 13'), v.borrador.duenos.so, elegir('admPo', 'PO 04'), v.borrador.duenos.po]);
      v.pintar(); v.pintar();
      await espera(50);
      apunta('C5', [document.querySelectorAll('#admPoSelector .dd').length, document.querySelectorAll('#admSoSelector .dd').length,
                    document.querySelectorAll('#admSoSelector .dd .dd').length, $('admSo').value,
                    dd('admSo').querySelector('.dd-valor').textContent]);

      // ---- V: aspecto del menu (el de SLA) ----
      var dv = abrir('admPo'), panel = dv.querySelector('.dd-panel'), cs = getComputedStyle(panel);
      apunta('V1', { fondo: cs.backgroundColor, radio: cs.borderTopLeftRadius, pos: cs.position, buscador: !!dv.querySelector('.dd-busca'),
                     dentro: panel.getBoundingClientRect().right <= document.documentElement.clientWidth });
      clic(document.body);

      // ---- M: Modificar (ADM) en el detalle ----
      var reg = pg.registro;
      reg.fijarDuenosCatalogo({ po: window.__POS, so: window.__SOS });
      reg.abrirDetalle('PRB 2026-000001');
      await espera(100);
      apunta('M1', [montado('regEd-so'), montado('regEd-po'), montado('regEd-estado')]);
      apunta('M2', [elegir('regEd-so', 'SO 21'), reg.edicion && reg.edicion.valores.so,
                    dd('regEd-so').querySelector('.dd-boton').getAttribute('aria-expanded')]);

      // ---- G: Seguimiento ----
      apunta('G1', [montado('regSegCategoria'), elegir('regSegCategoria', 'Cat 02').valor, reg.segCategoria]);

      // ---- S: Solicitar cambios ----
      function abrirCambio(campo) {
        clic($('regCambioBoton'));
        var c = $('regCambioCampo');
        c.value = campo;
        c.dispatchEvent(new Event('change', { bubbles: true }));
      }
      // Agregar solo va por el par capturado: con PO 04 / SO 19 la unica
      // categoria agregable es /A/Cat 19.
      var iniS = reg.registro.buscar('PRB 2026-000001'); iniS.po_capturado = 'PO 04'; iniS.so_capturado = 'SO 19';
      abrirCambio('pct');
      await espera(50);
      apunta('S1', [montado('regCambioCatBuscar'), !!document.querySelector('#regCambio datalist'), montado('regCambioEstado')]);
      apunta('SC', [!!$('regCambioCascPo'), !!$('regCambioCascSo'), filasTexto('regCambioCatBuscar')]);
      apunta('S2', elegir('regCambioCatBuscar', 'Cat 19'));
      clic(document.querySelector('[data-accion="cambio-cat-agregar"]'));
      await espera(50);
      apunta('S3', [reg.cambio.nuevas.map(function (x) { return x.categoria; }), montado('regCambioCatBuscar'),
                    document.querySelectorAll('#regCambioGrupoPct .dd .dd').length]);
      clic(document.querySelector('[data-accion="cambio-cancelar"]'));
      await espera(50);
      abrirCambio('pct');
      await espera(50);
      apunta('S4', [document.querySelectorAll('#regCambioGrupoPct .dd').length, document.querySelectorAll('#regCambio .dd .dd').length,
                    montado('regCambioCatBuscar')]);
    } catch (e) { apunta('error', String(e && e.stack || e)); }
    var pre = document.createElement('pre'); pre.id = '__res';
    pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  })();
}

var paginas = { '/admin/__desplegables.html': Banco.pagina('admin/iniciativas.html', '../assets/js/sesion-admin.js', ANTES, sonda) };

Banco.correr(paginas, ['/admin/__desplegables.html']).then(function (res) {
  var A = Banco.mapa(res[0]);
  if (A.error) console.log('ERROR en la sonda: ' + A.error);
  Check('N1 Nueva solicitud: Tipo, PO, SO y Categoria son el desplegable de SLA sobre su <select>', [true, true, true, true], A.N1);
  Check('N1b el boton sigue al disabled del <select>', true, A.N1b);
  Check('N2 elegir Tipo', { filas: 1, cerrado: true, valor: 'PRB', boton: 'Problem' }, A.N2);
  Check('N3 elegir PO con el buscador', { filas: 1, cerrado: true, valor: 'PO 02', boton: 'PO 02' }, A.N3);
  Check('N4 la cascada rehace el menu de SO: las mismas filas que el <select>, solo las del PO elegido',
    [true, ['SO 06', 'SO 07', 'SO 08', 'SO 09', 'SO 10']], A.N4);
  Check('N5 elegir SO de la cascada', { filas: 1, cerrado: true, valor: 'SO 07', boton: 'SO 07' }, A.N5);
  Check('C1 Crear: PO y SO son el desplegable, sin caja de texto ni datalist', [true, true, false], A.C1);
  Check('C2 el buscador filtra (sin mayusculas)', [true, ['SO 10', 'SO 11', 'SO 12', 'SO 13', 'SO 14', 'SO 15', 'SO 16', 'SO 17', 'SO 18', 'SO 19']], A.C2);
  Check('C3 lo escrito en el buscador no elige nada (ni Enter): sin filas, sin valor, Escape cierra', [0, '', '', false], A.C3);
  Check('C4 elegir llega al <select> y al borrador',
    [{ filas: 1, cerrado: true, valor: 'SO 13', boton: 'SO 13' }, 'SO 13', { filas: 1, cerrado: true, valor: 'PO 04', boton: 'PO 04' }, 'PO 04'], A.C4);
  Check('C5 repintar no duplica ni anida controles y conserva lo elegido', [1, 1, 0, 'SO 13', 'SO 13'], A.C5);
  Check('V1 menu de SLA: blanco, esquinas de 12px, fijo (no lo recorta la tarjeta), con buscador, dentro de la ventana',
    { fondo: 'rgb(255, 255, 255)', radio: '12px', pos: 'fixed', buscador: true, dentro: true }, A.V1);
  Check('M1 Modificar: SO, PO y Estado son el desplegable', [true, true, true], A.M1);
  Check('M2 elegir SO llega a la edicion y el menu se cierra',
    [{ filas: 1, cerrado: true, valor: 'SO 21', boton: 'SO 21' }, 'SO 21', 'false'], A.M2);
  Check('G1 Seguimiento: la categoria es el desplegable y elegir cambia la vista', [true, '/A/Cat 02', '/A/Cat 02'], A.G1);
  Check('S1 Solicitar cambios: categoria y Estado son el desplegable, sin datalist', [true, false, true], A.S1);
  Check('SC par capturado fijo: sin selectores de PO / SO; el desplegable solo trae sus categorias', [false, false, ['— Elige —', '/A/Cat 19']], A.SC);
  Check('S2 elegir categoria con el buscador', { filas: 1, cerrado: true, valor: '/A/Cat 19', boton: '/A/Cat 19' }, A.S2);
  Check('S3 Agregar suma la elegida; el selector repintado sigue montado, sin anidar', [['/A/Cat 19'], true, 0], A.S3);
  Check('S4 cancelar y reabrir: un desplegable de categoria, nada anidado', [1, 0, true], A.S4);
  console.log(fallos ? fallos + ' FALLO(S)' : 'TODO PASO');
  process.exit(fallos ? 1 : 0);
});
