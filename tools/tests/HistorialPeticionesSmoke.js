// Prueba en node de admin/historial-peticiones.js ("Historial de peticiones",
// pestaña Administracion), con documento y fetch falsos.
//
//   C  consulta(): dias LOCALES -> instantes UTC; "hasta" = inicio del dia
//      siguiente (excluido); desde > hasta y fechas mal escritas = aviso, sin
//      peticion; tipo solo INICIATIVA / CAMBIO.
//   H  htmlLista: los dos tipos distinguibles, estado con el rotulo de su
//      cola, faltantes con "—", todo escapado, sin botones de revisar.
//   V  la vista: cada filtro relee; respuesta vieja no pisa a la nueva;
//      rango invalido no pide; vacio con y sin filtro; error y 403; total
//      mayor que lo visible se dice; tabla que falta se dice; Limpiar vuelve
//      a todo; el folio abre su detalle (tipo, id).
//   W  la pagina: script cargado, seccion solo ADM, se abre con
//      Administracion y el folio va a Solicitudes.
//
//   node tools\tests\HistorialPeticionesSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var raiz = path.join(__dirname, '..', '..');
function leer(r) { return fs.readFileSync(path.join(raiz, r), 'utf8'); }

var fallos = 0;
function Check(titulo, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e !== o) fallos++;
  console.log((e === o ? 'PASS  ' : 'FAIL  ') + titulo + (e === o ? '' : '  esperado=' + e + '  obtenido=' + o));
}
function tic() { return new Promise(function (r) { setImmediate(r); }); }
async function tics(n) { for (var i = 0; i < (n || 5); i++) await tic(); }

function Elemento(id) {
  var oy = {};
  return { id: id, hidden: false, innerHTML: '', textContent: '', value: '',
    addEventListener: function (t, f) { (oy[t] = oy[t] || []).push(f); },
    disparar: function (t, e) { (oy[t] || []).forEach(function (f) { f(e || { target: this }); }, this); } };
}
function Documento() {
  var els = {};
  return { els: els, getElementById: function (id) { if (!els[id]) els[id] = Elemento(id); return els[id]; } };
}
function Respuesta(status, json) { return Promise.resolve({ status: status, json: function () { return Promise.resolve(json); } }); }
function Diferida() { var d = {}; d.promesa = new Promise(function (res) { d.resolver = res; }); return d; }

// TZ fija para que las cuentas UTC sean reproducibles (Mexico, UTC-6).
process.env.TZ = 'America/Mexico_City';
var caja = { Promise: Promise, encodeURIComponent: encodeURIComponent, Date: Date, isNaN: isNaN, Number: Number, String: String, console: console };
caja.window = caja;
vm.runInNewContext(leer('assets/js/escape.js'), caja);
vm.runInNewContext(leer('admin/historial-peticiones.js'), caja);
var HP = caja.HistorialPeticiones;

function P(o) {
  var b = { tipo: 'INICIATIVA', id: 12, folio: '#0000012', fecha_utc: '2026-10-20T15:05:00Z', solicitante_nombre: 'Ana Lopez',
            solicitante_cuenta: 'SORIANA\\ana', solicitante_correo: 'ana@soriana.com', rol_solicitante: null,
            iniciativa_codigo: null, iniciativa_titulo: 'Titulo pedido', detalle: 'PRB', estado: 'ENVIADA' };
  Object.keys(o || {}).forEach(function (k) { b[k] = o[k]; });
  return b;
}

(async function () {
  // ================= C) consulta =================
  Check('C1 sin filtros: sin querystring', { qs: '' }, HP.consulta('', '', ''));
  Check('C2 un dia local de Mexico: desde 06:00Z, hasta = 06:00Z del dia siguiente (excluido)',
    'desde=2026-10-02T06%3A00%3A00Z&hasta=2026-10-03T06%3A00%3A00Z', HP.consulta('2026-10-02', '2026-10-02', '').qs);
  Check('C3 fin de mes: hasta pasa al dia 1 siguiente', 'hasta=2026-11-01T06%3A00%3A00Z', HP.consulta('', '2026-10-31', '').qs);
  Check('C4 tipo', ['tipo=INICIATIVA', 'tipo=CAMBIO', ''], [HP.consulta('', '', 'INICIATIVA').qs, HP.consulta('', '', 'CAMBIO').qs, HP.consulta('', '', 'OTRO').qs]);
  Check('C5 desde > hasta: aviso claro', 'La fecha desde no puede ser posterior a la fecha hasta.', HP.consulta('2026-10-05', '2026-10-01', '').error);
  Check('C6 fecha mal escrita: aviso', ['La fecha desde no es válida.', 'La fecha hasta no es válida.'],
    [HP.consulta('5/10/2026', '', '').error, HP.consulta('', 'ayer', '').error]);

  // ================= H) htmlLista =================
  var html = HP.htmlLista([
    P(),
    P({ tipo: 'CAMBIO', id: 7, folio: '#7', solicitante_nombre: null, solicitante_cuenta: 'SORIANA\\t_mod', solicitante_correo: null,
        rol_solicitante: 'MOD', iniciativa_codigo: 'PRB 2026-000001', iniciativa_titulo: null, estado: 'PENDIENTE' }),
    P({ id: 13, folio: '#0000013', solicitante_nombre: null, solicitante_cuenta: null, solicitante_correo: null, iniciativa_titulo: '<b>x</b>',
        iniciativa_codigo: 'PRB 2026-000190', estado: 'APROBADA', fecha_utc: null })
  ]);
  Check('H1 los dos tipos con su rotulo y su clase', [true, true, true, true],
    [/ini-hp-iniciativa">Solicitar una iniciativa</.test(html), /ini-hp-cambio">Solicitar cambios</.test(html),
     /data-hp-tipo="CAMBIO" data-hp-id="7"/.test(html), /data-hp-tipo="INICIATIVA" data-hp-id="12"/.test(html)]);
  Check('H2 estado con el rotulo de su cola', [true, true, true], [/>Enviada</.test(html), />Pendiente</.test(html), />Aprobada</.test(html)]);
  Check('H3 cambio: cuenta + rol; iniciativa = codigo', [true, true], [/SORIANA\\t_mod <span class="chip ini-chip">MOD/.test(html), />PRB 2026-000001</.test(html)]);
  Check('H4 iniciativa aprobada: titulo pedido + codigo creado; escapado', [true, false], [/&lt;b&gt;x&lt;\/b&gt;<span class="ini-sub">PRB 2026-000190/.test(html), /<b>x<\/b>/.test(html)]);
  Check('H5 faltantes: "—" (sin fecha, sin solicitante)', 2, (html.match(/<td>—/g) || []).length);
  Check('H6 sin acciones de revision', false, /aprobar|rechazar|data-accion/i.test(html));
  Check('H7 columnas en orden', true, /Fecha<\/th><th scope="col">Tipo de petición<\/th><th scope="col">Folio<\/th><th scope="col">Solicitante<\/th><th scope="col">Iniciativa<\/th><th scope="col">Estado/.test(html));

  // ================= V) vista =================
  var doc = Documento(), cola = [], abiertos = [];
  var v = new HP.VistaHistorial(doc, function (url) { var d = Diferida(); cola.push({ url: url, d: d }); return d.promesa.then(function (a) { return Respuesta(a[0], a[1]); }); },
    function (tipo, id) { abiertos.push(tipo + ':' + id); });
  function $(id) { return doc.getElementById(id); }
  function visible() { return ['hpCargando', 'hpError', 'hpInvalido', 'hpVacio', 'hpLista'].filter(function (id) { return !$(id).hidden; }); }
  var OK = { peticiones: [P(), P({ tipo: 'CAMBIO', id: 7, folio: '#7', estado: 'RECHAZADA' })], total: 2, maximo: 500, iniciativas_disponible: true, cambios_disponible: true };
  v.abrir(); v.abrir(); await tics();
  Check('V1 abrir: pide todo el historial, sin rango; "Cargando"', ['../handlers/admin_iniciativas_historial.ashx', ['hpCargando']], [cola[0].url, visible()]);
  cola[1].d.resolver([200, OK]); await tics();
  cola[0].d.resolver([200, { peticiones: [], total: 0 }]); await tics();
  Check('V2 la respuesta vieja no pisa a la nueva; lista y cuenta', [['hpLista'], '2 peticiones'], [visible(), $('hpCuenta').textContent]);
  var n = cola.length;
  $('hpDesde').value = '2026-10-02'; $('hpDesde').disparar('change'); await tics();
  $('hpHasta').value = '2026-10-01'; $('hpHasta').disparar('change'); await tics();
  Check('V3 desde > hasta: aviso y NINGUNA peticion nueva para ese rango', [['hpInvalido'], 'La fecha desde no puede ser posterior a la fecha hasta.', n + 1],
    [visible(), $('hpInvalido').textContent, cola.length]);
  cola[n].d.resolver([200, OK]); await tics();
  Check('V3b la respuesta del filtro anterior no tapa el aviso', ['hpInvalido'], visible());
  $('hpHasta').value = '2026-10-02'; $('hpHasta').disparar('change');
  $('hpTipo').value = 'CAMBIO'; $('hpTipo').disparar('change'); await tics();
  Check('V4 cada filtro relee (sin recargar la pagina)', '../handlers/admin_iniciativas_historial.ashx?desde=2026-10-02T06%3A00%3A00Z&hasta=2026-10-03T06%3A00%3A00Z&tipo=CAMBIO',
    cola[cola.length - 1].url);
  cola[cola.length - 1].d.resolver([200, { peticiones: [], total: 0, cambios_disponible: true }]); await tics();
  Check('V5 vacio con filtros', [['hpVacio'], 'No hay peticiones con estos filtros.'], [visible(), $('hpVacioTexto').textContent]);
  $('hpLimpiar').disparar('click'); await tics();
  Check('V6 Limpiar: sin filtros y pide todo', ['', '', '', '../handlers/admin_iniciativas_historial.ashx'],
    [$('hpDesde').value, $('hpHasta').value, $('hpTipo').value, cola[cola.length - 1].url]);
  cola[cola.length - 1].d.resolver([200, { peticiones: [], total: 0, iniciativas_disponible: true, cambios_disponible: false }]); await tics();
  Check('V7 vacio sin filtros; y la tabla que falta se dice', ['Todavía no hay peticiones enviadas.', false, true],
    [$('hpVacioTexto').textContent, $('hpFuentes').hidden, /solicitudes de cambio/.test($('hpFuentes').textContent)]);
  $('hpActualizar').disparar('click'); await tics();
  var muchas = []; for (var i = 0; i < 500; i++) muchas.push(P({ id: i + 1 }));
  cola[cola.length - 1].d.resolver([200, { peticiones: muchas, total: 620, iniciativas_disponible: true, cambios_disponible: true }]); await tics();
  Check('V8 mas de las visibles: lo dice (nada se esconde callado)', 'Mostrando las 500 más recientes de 620. Acota las fechas para ver las demás.', $('hpCuenta').textContent);
  $('hpActualizar').disparar('click'); await tics();
  cola[cola.length - 1].d.resolver([403, { error: 'Solo un administrador (ADM) puede ver el historial de peticiones.', tipo: 'RolInsuficiente' }]); await tics();
  Check('V9 403: error con el mensaje del servidor, sin lista', [['hpError'], 'Solo un administrador (ADM) puede ver el historial de peticiones.'],
    [visible(), $('hpErrorTexto').textContent]);
  $('hpReintentar').disparar('click'); await tics();
  var ultima = cola[cola.length - 1];
  ultima.d.resolver([200, OK]); await tics();
  var boton = { getAttribute: function (k) { return k === 'data-hp-tipo' ? 'CAMBIO' : k === 'data-hp-id' ? '7' : null; } };
  $('hpLista').disparar('click', { target: { closest: function () { return boton; } } });
  Check('V10 Reintentar relee; el folio abre su detalle (tipo, id)', [['hpLista'], ['CAMBIO:7']], [visible(), abiertos]);

  // ================= W) la pagina =================
  var pag = leer('admin/iniciativas.js'), htmlPag = leer('admin/iniciativas.html'), hnd = leer('handlers/admin_iniciativas_historial.ashx');
  Check('W1 script antes de iniciativas.js; seccion solo ADM con sus filtros', [true, true, true],
    [htmlPag.indexOf('<script src="historial-peticiones.js">') > 0 && htmlPag.indexOf('<script src="historial-peticiones.js">') < htmlPag.indexOf('<script src="iniciativas.js">'),
     /id="hpSeccion" aria-labelledby="hpTitulo" data-solo-adm hidden/.test(htmlPag),
     /<option value="">Todas<\/option>\s*<option value="INICIATIVA">Solicitar una iniciativa<\/option>\s*<option value="CAMBIO">Solicitar cambios<\/option>/.test(htmlPag)]);
  Check('W2 se abre con Administracion; el folio va a Solicitudes y a su vista', [true, true, true, true],
    [/nombre === 'administracion' && this\.historial\) this\.historial\.abrir\(\)/.test(pag), /self\.mostrarVista\('solicitudes'\)/.test(pag),
     /self\.nuevas\.verDetalle\(id\)/.test(pag), /self\.cola\.verDetalle\(id\)/.test(pag)]);
  Check('W3 el handler exige ADM antes de leer y solo GET', [true, true],
    [hnd.indexOf('AccesoAdmin.ExigirAdm(') > 0 && hnd.indexOf('AccesoAdmin.ExigirAdm(') < hnd.indexOf('DashboardHandler.Responder('), /Usa GET/.test(hnd)]);

  console.log(fallos === 0 ? 'TODO PASO' : fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
