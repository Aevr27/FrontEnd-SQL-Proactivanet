// tools/tests/SolicitudesCambioColaSmoke.js - la cola de ADM de "Solicitar
// cambios" (admin/solicitudes-cambio.js): lo que se pinta (etapa de la fecha,
// antes / pedido / ahora, desactualizada, ultimo error, clasificacion) y lo
// que se manda (aplicar, rechazar), con un DOM minimo y un `pedir` falso.
// "Aplicada" / "rechazada" solo con la respuesta del servidor.
//
//   node tools\tests\SolicitudesCambioColaSmoke.js   # sale 0 si todo paso
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
  return { id: id, hidden: false, innerHTML: '', className: '', value: '', escuchas: {},
    addEventListener: function (t, f) { this.escuchas[t] = f; } };
}
function Documento() {
  var els = {}, selectores = {};
  return {
    els: els, selectores: selectores,
    getElementById: function (id) { if (!els[id]) els[id] = Elemento(id); return els[id]; },
    querySelector: function (s) { return selectores[s] || null; },
  };
}

function Respuesta(status, json) { return Promise.resolve({ status: status, json: function () { return Promise.resolve(json); } }); }
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }
function campos(fd) { var c = {}; fd.forEach(function (v, k) { c[k] = c[k] === undefined ? v : [].concat(c[k], v); }); return c; }

function Pendiente(o) {
  var d = { id: 41, folio: 'PRB 2026-000001', titulo: 'Uno', tipo: 'ESTADO', estado: 'PENDIENTE',
    estado_anterior: 'En Solución', estado_nuevo: 'En Monitoreo', subestado_anterior: null, subestado_nuevo: null,
    campo_fecha: 'FechaSolucion', etapa: 'Solución', fecha_anterior: '2026-11-15', fecha_nueva: '2026-12-05', fecha_actual: '2026-11-15',
    motivo: '<b>Proveedor</b>', solicitado_por: 'SORIANA\\t_mod', rol_solicitante: 'MOD', fecha_solicitud_utc: '2026-10-19T16:00:00Z',
    intentos: 0, ultimo_error: null, categorias: 0, sin_clasificar: 0, desactualizada: false,
    actual: { estado: 'En Solución', subestado: null }, categorias_detalle: [], eventos: [{ id: 1, evento: 'ENVIADA', usuario: 'SORIANA\\t_mod', fecha_utc: '2026-10-19T16:00:00Z', detalle: 'Rol MOD' }] };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}

// ---- render puro ------------------------------------------------------------
var html = C.htmlDetalle(Pendiente(), { iniciativa: ['Problem'], agrupado: ['Problem'] });
Check('R1 la fecha dice su etapa; antes / pedido / ahora', [true, true, true],
  [/Fecha compromiso de Solución<\/th><td>15\/11\/2026<\/td><td>05\/12\/2026<\/td><td>15\/11\/2026/.test(html),
   /En Solución<\/td><td>En Monitoreo/.test(html), /<th scope="col">Ahora<\/th>/.test(html)]);
Check('R2 el motivo se escapa; botones de aplicar y rechazar en una pendiente', [true, false, true, true],
  [/&lt;b&gt;Proveedor&lt;\/b&gt;/.test(html), /<b>Proveedor<\/b>/.test(html), /data-sol-accion="aplicar">Aplicar solicitud/.test(html), /data-sol-accion="rechazar"/.test(html)]);
html = C.htmlDetalle(Pendiente({ desactualizada: true, intentos: 1, ultimo_error: '51204: La iniciativa cambio', fecha_actual: '2026-11-20' }), {});
Check('R3 desactualizada y ultimo error, con explicacion', [true, true],
  [/Desactualizada:<\/strong> la iniciativa cambió desde que se envió/.test(html), /Último intento[\s\S]*51204: La iniciativa cambio/.test(html)]);
var cat = { categoria: '/B/Cat 3', accion: 'AGREGAR', pct_anterior: null, pct_nuevo: '15', pct_actual: null, tipo_iniciativa: null, tipo_agrupado: null, ligada: false, ligada_alguna_vez: false };
html = C.htmlDetalle(Pendiente({ tipo: 'CATEGORIAS', campo_fecha: null, categorias_detalle: [cat] }), { iniciativa: ['Problem', 'SorIA'], agrupado: ['Problem'] });
Check('R4 categoria por agregar sin clasificacion: ADM la elige (valores que existen) y se avisa', [true, true, true],
  [/data-clas-ti="0" data-clas-categoria="\/B\/Cat 3"><option value="">— Elige —<\/option><option value="Problem">Problem<\/option><option value="SorIA">SorIA/.test(html),
   /data-clas-ta="0"/.test(html), /llegó sin clasificación/.test(html)]);
html = C.htmlDetalle(Pendiente({ estado: 'APLICADA', revisado_por: 'SORIANA\\t_adm', fecha_revision_utc: '2026-10-19T17:00:00Z', comentario_revision: 'ok' }), {});
Check('R5 revisada: quien y cuando; sin aplicar ni rechazar', [true, false, false],
  [/Aplicada por SORIANA\\t_adm/.test(html), /data-sol-accion="aplicar"/.test(html), /data-sol-accion="rechazar"/.test(html)]);
html = C.htmlDetalle(Pendiente({ tipo: 'OTROS', campo_fecha: null }), {});
Check('R6 Otros: se cierra como atendida, con comentario obligatorio', [true, true],
  [/Cerrar como atendida/.test(html), /Qué se corrigió \(obligatorio para cerrarla\)/.test(html)]);
Check('R7 lista: intentos fallidos a la vista; resumen con la etapa', [true, true],
  [/1 intento</.test(C.htmlLista([Pendiente({ intentos: 1, ultimo_error: 'x' })])),
   /Fecha compromiso de Solución: 15\/11\/2026 → 05\/12\/2026/.test(C.resumen(Pendiente()))]);

// ---- flujos -----------------------------------------------------------------
var doc = Documento(), pedidos = [], respuestas = [];
function pedir(url, op) {
  pedidos.push({ url: url, metodo: op && op.method || 'GET', campos: op && op.body ? campos(op.body) : null });
  var r = respuestas.shift();
  return r ? r() : Promise.reject(new Error('sin red'));
}
function responder(status, json) { respuestas.push(function () { return Respuesta(status, json); }); }
var cola = new C.ColaSolicitudes(doc, pedir, function () { return { iniciativa: ['Problem'], agrupado: ['Problem'] }; });
var releidas = [];
cola.alCambiarIniciativa = function (folio) { releidas.push(folio); };

cola.fijarRol('MOD');
cola.abrir().then(function () {
  Check('F1 MOD: solo la nota, ninguna peticion', [true, false, 0], [doc.els.solCola.hidden, doc.els.solNoAdm.hidden, pedidos.length]);
  cola.fijarRol('ADM');
  responder(501, { error: 'Falta aplicar sql/22.', tipo: 'PersistenciaNoHabilitada' });
  return cola.abrir();
}).then(function () {
  Check('F2 ADM sin sql/22: GET listar de pendientes y el aviso del servidor tal cual', ['../handlers/admin_iniciativas_solicitudes.ashx?accion=listar&estado=PENDIENTE', 'ini-cambio-msg aviso', true],
    [pedidos[0].url, doc.els.solMsg.className, /Falta aplicar sql\/22/.test(doc.els.solMsg.innerHTML)]);
  responder(200, { solicitudes: [Pendiente()] });
  return cola.listar();
}).then(function () {
  Check('F3 lista pintada', true, /data-sol-id="41"/.test(doc.els.solLista.innerHTML));
  responder(200, Pendiente({ tipo: 'CATEGORIAS', campo_fecha: null, categorias_detalle: [cat] }));
  return cola.verDetalle(41);
}).then(function () {
  Check('F4 detalle por GET', ['../handlers/admin_iniciativas_solicitudes.ashx?accion=detalle&id=41', false], [pedidos[pedidos.length - 1].url, doc.els.solDetalle.hidden]);
  var n = pedidos.length;
  return cola.aplicar().then(function () {
    Check('F5 sin elegir la clasificacion: no se manda nada y se dice', [n, 'ini-cambio-msg error', true],
      [pedidos.length, doc.els.solDetMsg.className, /Elige Tipo de iniciativa y Agrupación de: \/B\/Cat 3/.test(doc.els.solDetMsg.innerHTML)]);
  });
}).then(function () {
  doc.selectores['[data-clas-ti="0"]'] = { value: 'Problem' };
  doc.selectores['[data-clas-ta="0"]'] = { value: 'Problem' };
  doc.els.solComentario = Elemento('solComentario'); doc.els.solComentario.value = '  revisado  ';
  responder(409, { error: 'La iniciativa cambio desde que se envio la solicitud.', tipo: 'SolicitudDesactualizada', numero: 51204, aplicada: false });
  responder(200, { solicitudes: [] });
  responder(200, Pendiente({ tipo: 'CATEGORIAS', campo_fecha: null, categorias_detalle: [cat], intentos: 1, desactualizada: true }));
  return cola.aplicar();
}).then(function () {
  var post = pedidos.filter(function (x) { return x.metodo === 'POST'; })[0];
  Check('F6 POST aplicar: id, comentario y la clasificacion elegida (sin revisor)', ['../handlers/admin_iniciativas_solicitudes.ashx?accion=aplicar', '41', 'revisado', '/B/Cat 3', 'Problem', 'Problem', false],
    [post.url, post.campos.id, post.campos.comentario, post.campos.clas_categoria, post.campos.clas_tipo_iniciativa, post.campos.clas_tipo_agrupado, 'revisor' in post.campos]);
  Check('F7 desactualizada: NO dice aplicada; sigue pendiente; se releyo la cola y el detalle; el registro no se relee', ['ini-cambio-msg error', false, true, true, []],
    [doc.els.solDetMsg.className, /aplicada:/.test(doc.els.solDetMsg.innerHTML), /sigue pendiente/.test(doc.els.solDetMsg.innerHTML),
     /Desactualizada/.test(doc.els.solDetalle.innerHTML), releidas]);
  responder(200, { aplicada: true, id_solicitud: 41 });
  responder(200, { solicitudes: [] });
  responder(200, Pendiente({ estado: 'APLICADA', revisado_por: 'SORIANA\\t_adm', fecha_revision_utc: '2026-10-19T17:00:00Z' }));
  return cola.aplicar();
}).then(function () {
  Check('F8 aplicada SOLO con la respuesta; se relee el registro de esa iniciativa', ['ini-cambio-msg listo', true, ['PRB 2026-000001']],
    [doc.els.solDetMsg.className, /Solicitud #41 aplicada/.test(doc.els.solDetMsg.innerHTML), releidas]);
  responder(200, Pendiente());
  return cola.verDetalle(41);
}).then(function () {
  doc.els.solComentario.value = ' ';
  var n = pedidos.length;
  return cola.rechazar().then(function () {
    Check('F9 rechazar sin comentario: no se manda', [n, true], [pedidos.length, /Escribe por qué se rechaza/.test(doc.els.solDetMsg.innerHTML)]);
  });
}).then(function () {
  doc.els.solComentario.value = 'No procede';
  responder(200, { rechazada: true, id_solicitud: 41 });
  responder(200, { solicitudes: [] });
  responder(200, Pendiente({ estado: 'RECHAZADA', revisado_por: 'SORIANA\\t_adm', fecha_revision_utc: '2026-10-19T17:00:00Z', comentario_revision: 'No procede' }));
  return cola.rechazar();
}).then(function () {
  var post = pedidos.filter(function (x) { return x.url.indexOf('accion=rechazar') >= 0; })[0];
  Check('F10 POST rechazar con el comentario; rechazada con la respuesta', ['41', 'No procede', 'ini-cambio-msg listo', true],
    [post.campos.id, post.campos.comentario, doc.els.solDetMsg.className, /rechazada\.<\/strong> La iniciativa no cambió/.test(doc.els.solDetMsg.innerHTML)]);
  responder(200, Pendiente({ tipo: 'OTROS', campo_fecha: null }));
  return cola.verDetalle(41);
}).then(function () {
  doc.els.solComentario.value = '';
  var n = pedidos.length;
  return cola.aplicar().then(function () {
    Check('F11 Otros sin comentario: no se cierra', [n, true], [pedidos.length, /Escribe qué se corrigió/.test(doc.els.solDetMsg.innerHTML)]);
  });
}).then(function () {
  doc.els.solComentario.value = 'Corregido a mano';
  return cola.aplicar();   // sin respuesta preparada: la red falla
}).then(function () {
  Check('F12 sin red: no se sabe; nunca "aplicada"', ['ini-cambio-msg aviso', true, false],
    [doc.els.solDetMsg.className, /no se sabe si se aplicó/.test(doc.els.solDetMsg.innerHTML), /aplicada:/.test(doc.els.solDetMsg.innerHTML)]);
}).then(function () {
  console.log(fallos === 0 ? 'TODO PASO' : fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
}, function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
