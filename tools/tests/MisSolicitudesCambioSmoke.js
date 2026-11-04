// Prueba en node de "Mis solicitudes de cambio" (admin/solicitudes-cambio.js,
// MisCambios, 2026-11-04) y de su lugar en la pagina (iniciativas.html /
// iniciativas.js), sin navegador ni servidor.
//
//   R  render: lista sin "Solicito" ni intentos; detalle de solo lectura
//      (solo "Cerrar": sin aplicar, rechazar, comentario, clasificar ni ids
//      de la cola de ADM); el detalle de ADM sigue igual.
//   L  lista: solo el endpoint propio (nunca el de ADM), filtro Estado
//      (Todas por omision; Pendientes / Aplicadas / Rechazadas), vacia,
//      403, 501, sin conexion, respuesta vieja no pisa a la nueva.
//   D  detalle: 200, 404 (otra cuenta), cerrar.
//   P  pagina: bloque y filtro en el HTML; iniciativas.js lo abre para quien
//      no es ADM y lo oculta para ADM / sin acceso.
// Correr: node tools/tests/MisSolicitudesCambioSmoke.js
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var raiz = path.join(__dirname, '..', '..');
var caja = { Promise: Promise, FormData: FormData, encodeURIComponent: encodeURIComponent, Date: Date, isNaN: isNaN, console: console };
caja.window = caja; caja.globalThis = caja;
vm.runInNewContext(fs.readFileSync(path.join(raiz, 'assets', 'js', 'escape.js'), 'utf8'), caja);
vm.runInNewContext(fs.readFileSync(path.join(raiz, 'admin', 'solicitudes-cambio.js'), 'utf8'), caja);
var C = caja.SolicitudesCambioCola;

var fallos = 0;
function Check(titulo, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e !== o) fallos++;
  console.log((e === o ? 'PASS  ' : 'FAIL  ') + titulo + (e === o ? '' : '  esperado=' + e + '  obtenido=' + o));
}
function Elemento(id) {
  return { id: id, hidden: false, innerHTML: '', textContent: '', className: '', value: '', escuchas: {},
    addEventListener: function (t, f) { this.escuchas[t] = f; } };
}
function Documento() {
  var els = {};
  return { els: els, getElementById: function (id) { if (!els[id]) els[id] = Elemento(id); return els[id]; } };
}
function Respuesta(status, json) { return Promise.resolve({ status: status, json: function () { return Promise.resolve(json); } }); }
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

function Sol(o) {
  var d = { id: 41, folio: 'PRB 2026-000001', titulo: 'Uno', tipo: 'ESTADO', estado: 'PENDIENTE',
    estado_anterior: 'En Solución', estado_nuevo: 'En Monitoreo', subestado_anterior: null, subestado_nuevo: null,
    campo_fecha: null, motivo: '<b>Proveedor</b>', solicitado_por: 'SORIANA\\juanperez', rol_solicitante: 'PSO',
    fecha_solicitud_utc: '2026-10-19T16:00:00Z', categorias: 0, desactualizada: false,
    actual: { estado: 'En Solución', subestado: null }, categorias_detalle: [],
    eventos: [{ id: 1, evento: 'ENVIADA', usuario: 'SORIANA\\juanperez', fecha_utc: '2026-10-19T16:00:00Z', detalle: 'Rol PSO' }] };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}
var URLM = '../handlers/admin_iniciativas_mis_cambios.ashx';

(async function () {
  // ---- R: render ----
  var lista = C.htmlListaMias([Sol({ titulo: '<i>x</i>' })], '');
  Check('R1 lista propia: #, iniciativa, que cambia, pedido, enviada, estado; sin Solicito; escapa', [true, true, false, true, false],
    [/data-mc-id="41"[^>]*>#41<\/button>/.test(lista), /<td>Pendiente<\/td>/.test(lista), /Solicitó/.test(lista),
     /&lt;i&gt;x&lt;\/i&gt;/.test(lista), /<i>x<\/i>/.test(lista)]);
  Check('R2 lista vacia: sin filtro / con filtro', [true, true],
    [/Todavía no has enviado solicitudes de cambio/.test(C.htmlListaMias([], '')), /No tienes solicitudes de cambio con ese estado/.test(C.htmlListaMias([], 'APLICADA'))]);
  var cats = [{ categoria: '/A/B', accion: 'AGREGAR', pct_anterior: null, pct_nuevo: '10', tipo_iniciativa: null, tipo_agrupado: null, ligada: false, ligada_alguna_vez: false }];
  var det = C.htmlDetalle(Sol({ tipo: 'VARIOS', categorias_detalle: cats, desactualizada: true, ultimo_error: 'SECRETO' }), null, null, true);
  Check('R3 detalle de lectura: solo Cerrar; sin aplicar/rechazar/comentario/clasificar/impacto/ids de la cola', [true, false, false, false, false, false, false, false],
    [/data-mc-accion="cerrar"/.test(det), /data-sol-accion/.test(det), /solComentario|solDetMsg/.test(det), /data-clas-/.test(det),
     /Impacto por categoría|solVol-/.test(det), /SECRETO/.test(det), /recházala/.test(det), /una sola decisión/.test(det)]);
  Check('R4 detalle de lectura: motivo escapado, historial y aviso de desactualizada para quien envio', [true, true, true],
    [/&lt;b&gt;Proveedor&lt;\/b&gt;/.test(det), /Historial de la solicitud/.test(det), /cambió desde que la enviaste/.test(det)]);
  var rech = C.htmlDetalle(Sol({ estado: 'RECHAZADA', revisado_por: 'SORIANA\\t_adm', fecha_revision_utc: '2026-10-20T10:00:00Z', comentario_revision: 'No procede' }), null, null, true);
  Check('R5 rechazada: se ve quien y por que', true, /Rechazada por SORIANA\\t_adm[\s\S]*No procede/.test(rech));
  var adm = C.htmlDetalle(Sol({ categorias_detalle: cats }), { iniciativa: ['Problem'], agrupado: ['Problem'] }, {});
  Check('R6 detalle de ADM sin cambios: aplicar, rechazar, comentario, clasificar, impacto', [true, true, true, true, true],
    [/data-sol-accion="aplicar"/.test(adm), /data-sol-accion="rechazar"/.test(adm), /id="solComentario"/.test(adm), /data-clas-ti="0"/.test(adm), /Impacto por categoría/.test(adm)]);

  // ---- L: lista ----
  function Montar(resps) {
    var doc = Documento(), pedidas = [];
    var v = new C.MisCambios(doc, function (url) { pedidas.push(url); var r = resps.shift(); return typeof r === 'function' ? r() : r; });
    return { doc: doc, v: v, pedidas: pedidas, $: function (id) { return doc.getElementById(id); } };
  }
  var m = Montar([Respuesta(200, { solicitudes: [Sol({ id: 2, fecha_solicitud_utc: '2026-10-01T00:00:00Z' }), Sol({ id: 5 })], maximo: 200 }),
                  Respuesta(200, { solicitudes: [Sol({ id: 7, estado: 'APLICADA' })], maximo: 200 }),
                  Respuesta(200, { solicitudes: [], maximo: 200 }),
                  Respuesta(200, { solicitudes: [], maximo: 200 }),
                  Respuesta(200, { solicitudes: [], maximo: 200 })]);
  await m.v.abrir();
  Check('L1 abrir: se ve, Todas por omision, solo el endpoint propio, recientes primero', [false, '', [URLM + '?accion=listar'], true, '2 solicitudes'],
    [m.$('mcBloque').hidden, m.$('mcFiltro').value, m.pedidas, m.$('mcLista').innerHTML.indexOf('#5') < m.$('mcLista').innerHTML.indexOf('#2'),
     m.$('mcResumen').textContent]);
  var pasos = [['APLICADA', 1], ['RECHAZADA', 2], ['PENDIENTE', 3], ['', 4]];
  for (var i = 0; i < pasos.length; i++) {
    m.$('mcFiltro').escuchas.change({ target: { value: pasos[i][0] } });
    await esperar();
  }
  Check('L2 filtro Estado: Aplicadas / Rechazadas / Pendientes / Todas al endpoint propio',
    [URLM + '?accion=listar&estado=APLICADA', URLM + '?accion=listar&estado=RECHAZADA', URLM + '?accion=listar&estado=PENDIENTE', URLM + '?accion=listar'],
    m.pedidas.slice(1));
  Check('L3 ninguna peticion al endpoint de ADM', false, m.pedidas.some(function (u) { return /admin_iniciativas_solicitudes\.ashx/.test(u); }));
  var neg = Montar([Respuesta(403, { error: 'La solicitud de iniciativas está disponible únicamente para PO y SO vigentes.' })]);
  await neg.v.abrir();
  Check('L4 403: mensaje del servidor, sin lista', [true, ''], [/únicamente para PO y SO/.test(neg.$('mcMsg').innerHTML), neg.$('mcLista').innerHTML]);
  var no = Montar([Respuesta(501, { error: 'El registro de solicitudes todavía no está habilitado' })]);
  await no.v.abrir();
  Check('L5 501: aviso', [true, true], [/aviso/.test(no.$('mcMsg').className), /no está habilitado/.test(no.$('mcMsg').innerHTML)]);
  var caida = Montar([function () { return Promise.reject(new Error('red')); }]);
  await caida.v.abrir();
  Check('L6 sin conexion: lo dice', true, /No se pudo contactar al servidor/.test(caida.$('mcMsg').innerHTML));
  var lento, carrera = Montar([function () { return new Promise(function (ok) { lento = ok; }); }, Respuesta(200, { solicitudes: [Sol({ id: 9 })] })]);
  var p1 = carrera.v.abrir();
  await carrera.v.listar();
  lento({ status: 200, json: function () { return Promise.resolve({ solicitudes: [Sol({ id: 1 })] }); } });
  await p1;
  Check('L7 una respuesta vieja no pisa a la nueva', [true, false], [/#9/.test(carrera.$('mcLista').innerHTML), /#1</.test(carrera.$('mcLista').innerHTML)]);

  // ---- D: detalle ----
  var d = Montar([Respuesta(200, { solicitudes: [Sol()] }), Respuesta(200, Sol()), Respuesta(404, { error: 'La solicitud no existe.', tipo: 'SolicitudNoExiste' })]);
  await d.v.abrir();
  d.$('mcLista').escuchas.click({ target: { closest: function () { return { getAttribute: function () { return '41'; } }; } } });
  await esperar();
  Check('D1 clic en # abre el detalle propio (endpoint propio, id)', [URLM + '?accion=detalle&id=41', false, true],
    [d.pedidas[1], d.$('mcDetalle').hidden, /data-mc-accion="cerrar"/.test(d.$('mcDetalle').innerHTML)]);
  d.$('mcDetalle').escuchas.click({ target: { closest: function () { return { getAttribute: function () { return 'cerrar'; } }; } } });
  Check('D2 Cerrar: oculto y vacio', [true, ''], [d.$('mcDetalle').hidden, d.$('mcDetalle').innerHTML]);
  await d.v.verDetalle(99);
  Check('D3 404 (otra cuenta o no existe): mensaje, sin detalle', [true, true], [/no existe o no es tuya/.test(d.$('mcMsg').innerHTML), d.$('mcDetalle').hidden]);
  d.v.ocultar();
  Check('D4 ocultar: oculto y sin lo leido', [true, '', ''], [d.$('mcBloque').hidden, d.$('mcLista').innerHTML, d.$('mcResumen').textContent]);

  // ---- P: pagina ----
  var html = fs.readFileSync(path.join(raiz, 'admin', 'iniciativas.html'), 'utf8');
  var bloque = html.slice(html.indexOf('<div id="mcBloque"'), html.indexOf('</section>', html.indexOf('<div id="mcBloque"')));
  Check('P1 mcBloque nace oculto, con mcFiltro Pendientes / Aplicadas / Rechazadas / Todas (Todas elegida)', [true, true, true],
    [/<div id="mcBloque" hidden>/.test(html),
     /<select id="mcFiltro">\s*<option value="PENDIENTE">Pendientes<\/option>\s*<option value="APLICADA">Aplicadas<\/option>\s*<option value="RECHAZADA">Rechazadas<\/option>\s*<option value="" selected>Todas<\/option>/.test(bloque),
     ['mcResumen', 'mcActualizar', 'mcMsg', 'mcLista', 'mcDetalle'].every(function (id) { return bloque.indexOf('id="' + id + '"') > 0; })]);
  var pag = fs.readFileSync(path.join(raiz, 'admin', 'iniciativas.js'), 'utf8').replace(/\r\n/g, '\n');
  Check('P2 iniciativas.js: crea MisCambios, lo abre si no es ADM, lo oculta para ADM, sin acceso y al denegar', [true, true, true, 3],
    [/new window\.SolicitudesCambioCola\.MisCambios\(this\.doc, null\)/.test(pag),
     /if \(this\.misCambios\) \{\n\s*if \(adm\) this\.misCambios\.ocultar\(\);\n\s*else this\.misCambios\.abrir\(\);/.test(pag),
     /if \(!this\.puedeSolicitar && this\.misCambios\) this\.misCambios\.ocultar\(\);/.test(pag),
     (pag.match(/this\.misCambios\.ocultar\(\)/g) || []).length]);
  var src = fs.readFileSync(path.join(raiz, 'admin', 'solicitudes-cambio.js'), 'utf8');
  var clase = src.slice(src.indexOf('class MisCambios'), src.indexOf('return { ColaSolicitudes'));
  Check('P3 MisCambios no escribe: sin POST, FormData, aplicar ni rechazar', [false, false, false],
    [/method:\s*'POST'/.test(clase), /FormData/.test(clase), /accion=(aplicar|rechazar|enviar)/.test(clase)]);

  console.log(fallos === 0 ? 'OK: todo paso' : 'FALLOS: ' + fallos);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
