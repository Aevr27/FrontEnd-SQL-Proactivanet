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
// DATOS (sql/25): Titulo / PO / SO capturados, solo los pedidos.
var datos = Pendiente({ tipo: 'DATOS', campo_fecha: null, estado_anterior: null, estado_nuevo: null,
  cambia_titulo: true, titulo_anterior: 'Uno', titulo_nuevo: 'Uno <nuevo>', cambia_po: true, po_anterior: 'PO viejo', po_nuevo: null,
  cambia_so: false, so_anterior: null, so_nuevo: null, actual: { estado: 'En Solución', titulo: 'Uno', po: 'PO viejo', so: 'SO x' } });
Check('R8 DATOS en la lista: rotulo del tipo y solo lo pedido; vacio dicho como (vacío); escapado',
  [true, 'Título: Uno → Uno &lt;nuevo&gt;; Product Owner capturado: PO viejo → (vacío)', false],
  [/Título \/ Product Owner \/ Service Owner/.test(C.htmlLista([datos])), C.resumen(datos), /Service Owner capturado/.test(C.resumen(datos))]);
html = C.htmlDetalle(datos, {});
Check('R8 DATOS en el detalle: al enviar / pedido / ahora por dato pedido; SO no pedido no aparece; aplicar disponible',
  [true, true, false, true],
  [/<th scope="row">Título<\/th><td>Uno<\/td><td>Uno &lt;nuevo&gt;<\/td><td>Uno<\/td>/.test(html),
   /<th scope="row">Product Owner capturado<\/th><td>PO viejo<\/td><td>\(vacío\)<\/td><td>PO viejo<\/td>/.test(html),
   /Service Owner capturado/.test(html), /data-sol-accion="aplicar">Aplicar solicitud/.test(html)]);
// VARIOS (sql/34): Estado, dos fechas por etapa, una categoria y el Titulo
// en UNA solicitud; ADM ve cada cambio y decide sobre la solicitud entera.
var varios = Pendiente({ tipo: 'VARIOS', campo_fecha: null, estado_anterior: 'En Solución', estado_nuevo: 'En Monitoreo',
  fechas_varias: [{ campo: 'FechaAnalisis', etapa: 'Análisis', anterior: '2026-08-01', nueva: '2026-08-15', actual: '2026-08-01' },
                  { campo: 'FechaCierre', etapa: 'Cierre', anterior: '2026-12-20', nueva: '2027-01-31', actual: '2026-12-20' }],
  categorias: 1, cambia_titulo: true, titulo_anterior: 'Uno', titulo_nuevo: 'Uno varios', cambia_po: false, cambia_so: false,
  categorias_detalle: [{ categoria: '/A/Cat 1', accion: 'PCT', pct_anterior: '30', pct_nuevo: '40', pct_actual: '30', tipo_iniciativa: null, tipo_agrupado: null, ligada: true, ligada_alguna_vez: true }],
  actual: { estado: 'En Solución', titulo: 'Uno' } });
Check('R9 VARIOS en la lista: rotulo y cada cambio en el resumen',
  [true, 'Estado: En Solución → En Monitoreo; Fecha compromiso de Análisis: 01/08/2026 → 15/08/2026; Fecha compromiso de Cierre: 20/12/2026 → 31/01/2027; 1 categoría; Título: Uno → Uno varios'],
  [/Varios cambios/.test(C.htmlLista([varios])), C.resumen(varios)]);
html = C.htmlDetalle(varios, {});
Check('R9 VARIOS en el detalle: una fila por cambio, categorias, aviso de todo o nada y un solo Aplicar', [true, true, true, true, true, true, 1],
  [/<th scope="row">Estado \/ Subestado<\/th><td>En Solución<\/td><td>En Monitoreo/.test(html),
   /<th scope="row">Fecha compromiso de Análisis<\/th><td>01\/08\/2026<\/td><td>15\/08\/2026<\/td><td>01\/08\/2026<\/td>/.test(html),
   /<th scope="row">Fecha compromiso de Cierre<\/th><td>20\/12\/2026<\/td><td>31\/01\/2027<\/td>/.test(html),
   /<th scope="row">Título<\/th><td>Uno<\/td><td>Uno varios<\/td>/.test(html), /\/A\/Cat 1/.test(html),
   /aplicar aplica TODOS los cambios de arriba/.test(html), (html.match(/data-sol-accion="aplicar"/g) || []).length]);

// Quien envio: el nombre que resolvio el servidor (solicitante_nombre) o,
// sin el, la cuenta guardada; en los tres estados de la cola.
var conNombre = ['PENDIENTE', 'APLICADA', 'RECHAZADA'].map(function (e, n) {
  return Pendiente({ id: 50 + n, estado: e, solicitante_nombre: 'Juan Pérez <x>' });
});
html = C.htmlLista(conNombre);
Check('R10 lista: nombre completo en pendiente, aplicada y rechazada; la cuenta debajo; escapado', [3, 3, false],
  [(html.match(/<td>Juan Pérez &lt;x&gt; <span class="chip ini-chip">MOD<\/span><span class="ini-sub">SORIANA\\t_mod<\/span><\/td>/g) || []).length,
   (html.match(/<td>(Pendiente|Aplicada|Rechazada)/g) || []).length, html.indexOf('Juan Pérez <x>') >= 0]);
html = C.htmlLista([Pendiente({ solicitante_nombre: null }), Pendiente({ id: 42, estado: 'RECHAZADA' })]);
Check('R11 lista: sin nombre (no resuelta o ambigua) se muestra la cuenta, una sola vez', [2, false],
  [(html.match(/<td>SORIANA\\t_mod <span class="chip ini-chip">MOD<\/span><\/td>/g) || []).length, /ini-sub">SORIANA/.test(html)]);
Check('R12 detalle: "la envió" con el nombre y la cuenta; sin nombre, la cuenta', [true, true],
  [/la envió Juan Pérez \(SORIANA\\t_mod, MOD\) el/.test(C.htmlDetalle(Pendiente({ estado: 'APLICADA', solicitante_nombre: 'Juan Pérez' }), {})),
   /la envió SORIANA\\t_mod \(MOD\) el/.test(C.htmlDetalle(Pendiente(), {}))]);
html = C.htmlLista([Pendiente({ folio: 'PRB 2026-000001<' })], true);
Check('R13 con iniciativa: el Codigo es su propio boton (data-sol-folio, escapado) y el "#" sigue aparte', [true, true, true],
  [/<td><button type="button" class="ini-folio" data-sol-folio="PRB 2026-000001&lt;" title="Ver la iniciativa">PRB 2026-000001&lt;<\/button>/.test(html),
   /<td><button type="button" class="ini-folio" data-sol-id="41">#41<\/button><\/td>/.test(html), html.indexOf('PRB 2026-000001<"') < 0]);
Check('R14 sin quien abra la iniciativa: el Codigo queda como texto (como antes)', [false, true],
  [/data-sol-folio/.test(C.htmlLista([Pendiente()])), /<td>PRB 2026-000001<span class="ini-sub">Uno/.test(C.htmlLista([Pendiente()]))]);

// Un nodo del DOM para los clics: closest('[atributo]') sube por los padres.
function Nodo(attrs, padre) {
  return { attrs: attrs, padre: padre || null,
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    closest: function (sel) {
      var m = /^\[([\w-]+)\]$/.exec(sel);
      for (var n = this; n; n = n.padre) if (m && Object.prototype.hasOwnProperty.call(n.attrs, m[1])) return n;
      return null;
    } };
}

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
  // Dos enlaces por fila: el Codigo (dentro de la fila) abre la iniciativa;
  // el "#" y el resto de la fila, la solicitud.
  var iniciativas = [], solicitudes = [], verDetalle = cola.verDetalle;
  cola.verDetalle = function (id) { solicitudes.push(id); return Promise.resolve(); };
  var fila = Nodo({ 'data-sol-id': '41' });
  var clic = function (n) { doc.els.solLista.escuchas.click({ target: n }); };
  clic(Nodo({ 'data-sol-folio': 'PRB 2026-000001' }, Nodo({}, fila)));
  Check('F13 sin quien abra la iniciativa: el clic en el Codigo abre la solicitud (como antes)', [[], [41]], [iniciativas, solicitudes]);
  cola.alVerIniciativa = function (folio) { iniciativas.push(folio); };
  responder(200, { solicitudes: [Pendiente(), Pendiente({ id: 42, estado: 'APLICADA' }), Pendiente({ id: 43, estado: 'RECHAZADA', folio: 'PRB 2026-000003' })] });
  return cola.listar().then(function () {
    Check('F14 con quien la abra: el Codigo de pendiente, aplicada y rechazada es boton', 3,
      (doc.els.solLista.innerHTML.match(/data-sol-folio="/g) || []).length);
    solicitudes.length = 0;
    clic(Nodo({ 'data-sol-folio': 'PRB 2026-000003' }, Nodo({}, Nodo({ 'data-sol-id': '43' }))));
    Check('F15 clic en el Codigo: abre la iniciativa y NO la solicitud', [['PRB 2026-000003'], []], [iniciativas.slice(), solicitudes.slice()]);
    clic(Nodo({ 'data-sol-id': '43' }, Nodo({}, Nodo({ 'data-sol-id': '43' }))));
    clic(Nodo({}, fila));
    Check('F16 clic en el "#" o en otra celda: abre la solicitud, no la iniciativa', [['PRB 2026-000003'], [43, 41]], [iniciativas.slice(), solicitudes.slice()]);
    cola.verDetalle = verDetalle;
  });
}).then(function () {
  console.log(fallos === 0 ? 'TODO PASO' : fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
}, function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
