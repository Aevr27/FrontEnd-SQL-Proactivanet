// tools/tests/SolicitudesNuevasSmoke.js - la vista "Nuevas" de la pestaña
// Solicitudes (admin/solicitudes-nuevas.js): lo que se pinta (lista,
// detalle con historial, escape), cada respuesta dicha distinto (cargando,
// vacio, 501 sin tablas, 403, 500 de la base, sin conexion), el conmutador
// "Iniciativas | Cambios" por rol, y que la pagina la monta sin mover "Cambios".
// W: aprobar / rechazar (sql/31): botones solo en ENVIADA con
// revision_disponible, motivo obligatorio al rechazar, POST solo al endpoint
// de revision (nunca al de Cambios), relee lista y detalle, cada respuesta
// dicha distinto y un solo envio a la vez.
//
//   node tools\tests\SolicitudesNuevasSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var raiz = path.join(__dirname, '..', '..');
var caja = { Promise: Promise, FormData: FormData, encodeURIComponent: encodeURIComponent, Date: Date, isNaN: isNaN, console: console };
caja.window = caja; caja.globalThis = caja;
vm.runInNewContext(fs.readFileSync(path.join(raiz, 'assets', 'js', 'escape.js'), 'utf8'), caja);
vm.runInNewContext(fs.readFileSync(path.join(raiz, 'admin', 'solicitudes-nuevas.js'), 'utf8'), caja);
var N = caja.SolicitudesNuevas;

var fallos = 0;
function Check(titulo, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e !== o) fallos++;
  console.log((e === o ? 'PASS  ' : 'FAIL  ') + titulo + (e === o ? '' : '  esperado=' + e + '  obtenido=' + o));
}

function Elemento(id) {
  var clases = {};
  return { id: id, hidden: false, innerHTML: '', textContent: '', className: '', escuchas: {}, atributos: {},
    addEventListener: function (t, f) { this.escuchas[t] = f; },
    setAttribute: function (k, v) { this.atributos[k] = String(v); },
    classList: { toggle: function (c, on) { clases[c] = !!on; }, contains: function (c) { return !!clases[c]; } } };
}
function Documento() {
  var els = {};
  return { els: els, getElementById: function (id) { if (!els[id]) els[id] = Elemento(id); return els[id]; } };
}
function Respuesta(status, json) { return Promise.resolve({ status: status, json: function () { return Promise.resolve(json); } }); }

function Fila(n, o) {
  var d = { numero: n, numero_texto: '#' + String(n).padStart(7, '0'), estado: 'ENVIADA', tipo: 'ADO', titulo: 'Titulo ' + n,
    solicitante_nombre: 'Andres Vera Rios', solicitante_correo: 'andresvr@soriana.com', solicitante_cuenta: 'SORIANA\\andresvr',
    po: 'Jesus Campa Morones', po_correo: 'jesuscamor@soriana.com', so: 'SO 1', categoria: '/A/Cat 1', director: 'Dir 1',
    fecha_utc: '2026-10-22T15:00:00Z', eventos_total: 1 };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}
function Detalle(n, o) {
  var d = Fila(n, { descripcion: '<script>x</script>', observaciones: 'Obs', volumetria: 120, pct: '20', rca_extension: 'PDF',
    fuente_correos: 'CATPERSONA', eventos: [{ id: 1, evento: 'ENVIADA', estado_anterior: null, estado_nuevo: 'ENVIADA',
    usuario: 'SORIANA\\andresvr', fecha_utc: '2026-10-22T15:00:00Z' }] });
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}

// ---- render puro ------------------------------------------------------------
var html = N.htmlLista([Fila(2, { titulo: '<b>Dos</b>' }), Fila(1)]);
Check('R1 lista: numero, tipo, titulo, solicito, PO, SO, categoria, enviada y estado',
  [true, true, true, true, true, true, true],
  [/data-sn-numero="2">#0000002<\/button>/.test(html), /<td>ADO<\/td>/.test(html), /Andres Vera Rios<span class="ini-sub">andresvr@soriana.com/.test(html),
   /<td>Jesus Campa Morones<\/td><td>SO 1<\/td>/.test(html), /\/A\/Cat 1/.test(html), /<td>Enviada<\/td>/.test(html),
   /<th scope="col">Número<\/th>[\s\S]*<th scope="col">Estado<\/th>/.test(html)]);
Check('R2 el titulo se escapa', [true, false], [/&lt;b&gt;Dos&lt;\/b&gt;/.test(html), /<b>Dos<\/b>/.test(html)]);
Check('R3 lista vacia: lo dice', true, /Todavía no hay solicitudes nuevas guardadas/.test(N.htmlLista([])));
Check('R4 sin nombre resuelto: muestra la cuenta; nulos como —', [true, true],
  [/SORIANA\\andresvr/.test(N.htmlLista([Fila(3, { solicitante_nombre: null, solicitante_correo: null })])),
   /<td>—<\/td>/.test(N.htmlLista([Fila(4, { so: null })]))]);
html = N.htmlDetalle(Detalle(7));
Check('R5 detalle: campos, historial y solo "Cerrar" (sin aprobar ni rechazar)', [true, true, true, true, true, false, false],
  [/Solicitud #0000007 · Titulo 7/.test(html), /&lt;script&gt;x&lt;\/script&gt;/.test(html), /Historial de la solicitud<\/h5><ul class="ini-sol-eventos"><li><strong>Enviada<\/strong>/.test(html),
   /SORIANA\\andresvr<span class="ini-sub">— → Enviada/.test(html), /data-sn-accion="cerrar"/.test(html),
   /aplicar|rechazar|aprobar|borrar/i.test(html.replace(/data-sn-accion="cerrar"/, '')), /<script>/.test(html)]);
Check('R6 detalle sin eventos: lo dice', true, /Sin eventos registrados/.test(N.htmlDetalle(Detalle(8, { eventos: [] }))));
Check('R7 RCA: extension, sin archivo', true, /Adjunto \.pdf \(el archivo no se guarda\)/.test(html));
Check('R8 total: solo si hay mas de las que se ven', ['Mostrando las 2 más recientes de 250.', ''],
  [N.textoTotal({ solicitudes: [1, 2], total: 250 }), N.textoTotal({ solicitudes: [1, 2], total: 2 })]);

// ---- con un DOM y un pedir falso -------------------------------------------
function Montar(rol, respuestas) {
  var doc = Documento(), pedidas = [];
  var v = new N.RegistroSolicitudesNuevas(doc, function (url, op) {
    pedidas.push(url);
    var r = respuestas.shift();
    return typeof r === 'function' ? r() : r;
  });
  v.fijarRol(rol);
  return { doc: doc, v: v, pedidas: pedidas, $: function (id) { return doc.getElementById(id); } };
}

(async function () {
  // Rol: MOD / sin rol -> sin conmutador ni pedidos; "De cambio" visible.
  for (var rol of ['MOD', null]) {
    var m = Montar(rol, []);
    await m.v.abrir();
    Check('V1 rol ' + rol + ': sin conmutador, Nuevas oculta, De cambio visible, sin pedir nada', [true, true, false, 0],
      [m.$('solVistas').hidden, m.$('snBloque').hidden, m.$('solVistaCambio').hidden, m.pedidas.length]);
    await m.v.verNuevas();
    Check('V1 rol ' + rol + ': verNuevas no hace nada', [0, true], [m.pedidas.length, m.$('snBloque').hidden]);
  }
  // ADM: de inicio "De cambio" (como siempre), sin pedir.
  var a = Montar('ADM', [Respuesta(200, { solicitudes: [Fila(2), Fila(1)], total: 2, maximo: 200 })]);
  await a.v.abrir();
  Check('V2 ADM: conmutador visible y "De cambio" de inicio (sin pedir Nuevas)', [false, true, false, 0, 'true', 'false'],
    [a.$('solVistas').hidden, a.$('snBloque').hidden, a.$('solVistaCambio').hidden, a.pedidas.length,
     a.$('solVerCambio').atributos['aria-pressed'], a.$('solVerNuevas').atributos['aria-pressed']]);
  var lista = await a.v.verNuevas();
  Check('V3 Nuevas: pide listar y pinta; oculta De cambio', [1, '../handlers/admin_iniciativas_solicitudes_nuevas.ashx?accion=listar', 2, true, false, true, '', 'true'],
    [a.pedidas.length, a.pedidas[0], lista.length, /#0000002/.test(a.$('snLista').innerHTML), a.$('snBloque').hidden, a.$('solVistaCambio').hidden,
     a.$('snMsg').innerHTML, a.$('solVerNuevas').atributos['aria-pressed']]);
  var vuelta = 0;
  a.v.alVerCambio = function () { vuelta++; };
  a.v.verCambio();
  Check('V4 volver a De cambio: la muestra, oculta Nuevas y avisa a la pagina', [false, true, 1, true, false],
    [a.$('solVistaCambio').hidden, a.$('snBloque').hidden, vuelta, a.$('solVerCambio').classList.contains('activa'), a.$('solVerNuevas').classList.contains('activa')]);
  // Reabrir la pestaña con Nuevas elegida: relee.
  a = Montar('ADM', [Respuesta(200, { solicitudes: [], total: 0, maximo: 200 }), Respuesta(200, { solicitudes: [Fila(1)], total: 1, maximo: 200 })]);
  await a.v.verNuevas();
  Check('V5 sin solicitudes: 200 con el texto de vacio, sin error', [true, ''], [/Todavía no hay/.test(a.$('snLista').innerHTML), a.$('snMsg').className.trim().split(' ').slice(1).join(' ')]);
  await a.v.abrir();
  Check('V6 reabrir la pestaña con Nuevas elegida: vuelve a leer de la base', [2, true], [a.pedidas.length, /#0000001/.test(a.$('snLista').innerHTML)]);

  // Cargando: se ve mientras no llega la respuesta.
  var soltar;
  a = Montar('ADM', [function () { return new Promise(function (ok) { soltar = ok; }); }]);
  var p = a.v.verNuevas();
  await new Promise(function (ok) { setTimeout(ok, 0); });   // pedir corre en el siguiente turno
  Check('E1 cargando: mensaje mientras llega', [true, 'function'], [/Cargando solicitudes nuevas/.test(a.$('snMsg').innerHTML), typeof soltar]);
  soltar({ status: 200, json: function () { return Promise.resolve({ solicitudes: [], total: 0 }); } });
  await p;

  var casos = [
    ['E2 501 sin tablas: aviso con el motivo del servidor', Respuesta(501, { error: 'Faltan las tablas de sql/29', tipo: 'RegistroNoDisponible' }), 'aviso', /Faltan las tablas de sql\/29/],
    ['E3 403: sin permiso', Respuesta(403, { error: 'Solo un administrador (ADM)', tipo: 'RolInsuficiente' }), 'error', /Solo un administrador/],
    ['E4 500: error de la base, distinto de "sin tablas"', Respuesta(500, { error: 'Tiempo agotado', tipo: 'SqlException' }), 'error', /Error de la base de datos al leer las solicitudes: Tiempo agotado/],
    ['E5 respuesta no JSON: dice el codigo', function () { return Promise.resolve({ status: 502, json: function () { return Promise.reject(new Error('x')); } }); }, 'error', /respuesta 502/],
    ['E6 sin conexion', function () { return Promise.reject(new Error('red')); }, 'error', /No se pudo contactar al servidor/]
  ];
  for (var c of casos) {
    a = Montar('ADM', [c[1]]);
    a.$('snLista').innerHTML = 'viejo';
    var r = await a.v.verNuevas();
    Check(c[0], [null, c[2], true, ''], [r, a.$('snMsg').className.split(' ').pop(), c[3].test(a.$('snMsg').innerHTML), a.$('snLista').innerHTML]);
  }

  // Detalle.
  a = Montar('ADM', [Respuesta(200, Detalle(142)), Respuesta(404, { error: 'La solicitud no existe.', tipo: 'SolicitudNoExiste' }),
                     Respuesta(500, { error: 'falla', tipo: 'SqlException' })]);
  var d = await a.v.verDetalle(142);
  Check('D1 detalle: pide por numero y muestra el historial', ['../handlers/admin_iniciativas_solicitudes_nuevas.ashx?accion=detalle&numero=142', false, true, 142],
    [a.pedidas[0], a.$('snDetalle').hidden, /Historial de la solicitud/.test(a.$('snDetalle').innerHTML), d.numero]);
  a.v.cerrarDetalle();
  Check('D2 cerrar', [true, '', null], [a.$('snDetalle').hidden, a.$('snDetalle').innerHTML, a.v.detalle]);
  d = await a.v.verDetalle(9);
  Check('D3 404: lo dice y no abre nada', [null, true, true], [d, /La solicitud no existe/.test(a.$('snMsg').innerHTML), a.$('snDetalle').hidden]);
  d = await a.v.verDetalle(9);
  Check('D4 500 en el detalle: error de la base', [null, true], [d, /Error de la base de datos al leer la solicitud/.test(a.$('snMsg').innerHTML)]);

  // Clic en la lista y en Cerrar (cableado).
  a = Montar('ADM', [Respuesta(200, Detalle(5))]);
  a.v.cablear();
  a.$('snLista').escuchas.click({ target: { closest: function () { return { getAttribute: function () { return '5'; } }; } } });
  await new Promise(function (ok) { setTimeout(ok, 0); });
  Check('C1 clic en el numero abre el detalle', ['../handlers/admin_iniciativas_solicitudes_nuevas.ashx?accion=detalle&numero=5', false], [a.pedidas[0], a.$('snDetalle').hidden]);
  a.$('snDetalle').escuchas.click({ target: { closest: function () { return { getAttribute: function () { return 'cerrar'; } }; } } });
  Check('C2 Cerrar desde el detalle', true, a.$('snDetalle').hidden);

  // ---- W: aprobar / rechazar (sql/31) -----------------------------------------
  var URL_CAMBIOS = 'admin_iniciativas_solicitudes.ashx';
  function campos(fd) { var c = {}; fd.forEach(function (v, k) { c[k] = v; }); return c; }
  function Pedir(respuestas) {
    var p = { pedidas: [], envios: [] };
    p.fn = function (url, op) {
      p.pedidas.push(url);
      if (op && op.method === 'POST') p.envios.push({ url: url, campos: campos(op.body) });
      var r = respuestas.shift();
      return typeof r === 'function' ? r() : r;
    };
    return p;
  }
  function MontarRev(respuestas, detalle) {
    var doc = Documento(), p = Pedir(respuestas);
    var v = new N.RegistroSolicitudesNuevas(doc, p.fn);
    v.fijarRol('ADM');
    v.detalle = detalle;
    return { v: v, p: p, $: function (id) { return doc.getElementById(id); } };
  }
  var LISTA = { solicitudes: [Fila(9)], total: 1, maximo: 200, revision_disponible: true };

  html = N.htmlDetalle(Detalle(9, { revision_disponible: true }), true);
  Check('W1 ENVIADA con revision: comentario, Aprobar, Rechazar y Cerrar', [true, true, true, true],
    [/<textarea id="snComentario" rows="3" maxlength="2000">/.test(html), /data-sn-accion="aprobar">Aprobar</.test(html),
     /data-sn-accion="rechazar">Rechazar</.test(html), /data-sn-accion="cerrar">Cerrar</.test(html)]);
  Check('W2 sin revision_disponible (sin sql/31) o sin ADM: solo Cerrar', [false, false],
    [/data-sn-accion="aprobar"/.test(N.htmlDetalle(Detalle(9), false)), /snComentario/.test(N.htmlDetalle(Detalle(9), false))]);
  var aprobada = Detalle(9, { estado: 'APROBADA', revisado_por: 'SORIANA\\t_adm', fecha_revision_utc: '2026-10-23T17:05:09Z',
    comentario_revision: '<i>ok</i>', eventos: [Detalle(9).eventos[0],
      { id: 2, evento: 'APROBADA', estado_anterior: 'ENVIADA', estado_nuevo: 'APROBADA', usuario: 'SORIANA\\t_adm', fecha_utc: '2026-10-23T17:05:09Z', detalle: '<i>ok</i>' }] });
  html = N.htmlDetalle(aprobada, true);
  Check('W3 APROBADA: sin botones (final), quien, cuando, comentario escapado y aviso de Crear a mano', [false, true, true, true, false],
    [/data-sn-accion="aprobar"|data-sn-accion="rechazar"/.test(html), /<strong>Aprobada<\/strong> por SORIANA\\t_adm el /.test(html),
     /«&lt;i&gt;ok&lt;\/i&gt;»/.test(html), /Crea la iniciativa a mano en Administración → Crear/.test(html), /<i>ok<\/i>/.test(html)]);
  Check('W4 historial: el evento de revision con su comentario', true,
    /<strong>Aprobada<\/strong>[^<]*<span class="ini-sub">Enviada → Aprobada<\/span><span class="ini-sub">«&lt;i&gt;ok&lt;\/i&gt;»/.test(html));
  html = N.htmlDetalle(Detalle(9, { estado: 'RECHAZADA', revisado_por: 'x', fecha_revision_utc: '2026-10-23T17:05:09Z', comentario_revision: 'Sin capacidad' }), true);
  Check('W5 RECHAZADA: sin botones, con su motivo y sin aviso de Crear', [false, true, false],
    [/data-sn-accion="rechazar"/.test(html), /<strong>Rechazada<\/strong>[\s\S]*«Sin capacidad»/.test(html), /Crea la iniciativa/.test(html)]);

  // verDetalle: los botones salen solo con revision_disponible del servidor.
  var m2 = MontarRev([Respuesta(200, Detalle(9, { revision_disponible: false })), Respuesta(200, Detalle(9, { revision_disponible: true }))], null);
  await m2.v.verDetalle(9);
  var sinRev = /data-sn-accion="aprobar"/.test(m2.$('snDetalle').innerHTML);
  await m2.v.verDetalle(9);
  Check('W6 el detalle del servidor decide: sin sql/31 no hay botones; con sql/31 si', [false, true], [sinRev, /data-sn-accion="aprobar"/.test(m2.$('snDetalle').innerHTML)]);
  m2.v.fijarRol('MOD');
  m2.p.pedidas.length = 0;
  var m3 = MontarRev([Respuesta(200, Detalle(9, { revision_disponible: true }))], null);
  m3.v.fijarRol('MOD');
  await m3.v.verDetalle(9);
  Check('W6b sin rol ADM: sin botones aunque el servidor tenga sql/31', false, /data-sn-accion="aprobar"/.test(m3.$('snDetalle').innerHTML));

  // Rechazar sin motivo: no se manda nada.
  var w = MontarRev([], Detalle(9, { revision_disponible: true }));
  for (var vacio of ['', '   ']) {
    w.$('snComentario').value = vacio;
    var res = await w.v.rechazar();
    Check('W7 rechazar sin motivo (\'' + vacio + '\'): no se manda y se pide el motivo', [null, 0, true],
      [res, w.p.pedidas.length, /Escribe por qué se rechaza/.test(w.$('snDetMsg').innerHTML)]);
  }
  w.$('snComentario').value = new Array(2002).join('x');
  res = await w.v.aprobar();
  Check('W8 comentario de mas de 2000: no se manda', [null, 0, true], [res, w.p.pedidas.length, /no puede pasar de 2000/.test(w.$('snDetMsg').innerHTML)]);

  // Aprobar sin comentario: POST al endpoint de revision; relee lista y detalle.
  w = MontarRev([Respuesta(200, { aprobada: true, numero: 9, estado: 'APROBADA' }), Respuesta(200, LISTA),
                 Respuesta(200, Detalle(9, { estado: 'APROBADA', revisado_por: 'SORIANA\\t_adm', fecha_revision_utc: '2026-10-23T17:05:09Z', revision_disponible: true }))],
                Detalle(9, { revision_disponible: true }));
  w.$('snComentario').value = '';
  res = await w.v.aprobar();
  Check('W9 aprobar: POST a ...revision.ashx?accion=aprobar con solo el numero', ['../handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx?accion=aprobar', { numero: '9' }],
    [w.p.envios[0].url, w.p.envios[0].campos]);
  Check('W10 despues relee lista y detalle; dice aprobada y que se crea a mano; ya sin botones', [3, true, true, 'listo', false, false],
    [w.p.pedidas.length, /accion=listar/.test(w.p.pedidas[1]) || /accion=listar/.test(w.p.pedidas[2]), /accion=detalle&numero=9/.test(w.p.pedidas.join(' ')),
     w.$('snDetMsg').className.split(' ').pop(), /data-sn-accion="aprobar"/.test(w.$('snDetalle').innerHTML), w.v.ocupado]);
  Check('W10b el mensaje de exito habla de Crear a mano', true, /aprobada\.<\/strong> Crea la iniciativa a mano/.test(w.$('snDetMsg').innerHTML));

  w = MontarRev([Respuesta(200, { rechazada: true }), Respuesta(200, LISTA), Respuesta(200, Detalle(9, { estado: 'RECHAZADA', revision_disponible: true }))],
                Detalle(9, { revision_disponible: true }));
  w.$('snComentario').value = '  No hay capacidad  ';
  await w.v.rechazar();
  Check('W11 rechazar: POST con numero y el motivo recortado', ['../handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx?accion=rechazar', { numero: '9', comentario: 'No hay capacidad' }, 'listo'],
    [w.p.envios[0].url, w.p.envios[0].campos, w.$('snDetMsg').className.split(' ').pop()]);

  // Respuestas que no son exito: cada una dicha distinto; siempre relee.
  var errores = [
    ['W12 409 ya revisada (otro ADM gano)', Respuesta(409, { error: 'La solicitud ya fue revisada (aprobada o rechazada).', tipo: 'YaRevisada', aprobada: false }), 'error', /No se aprobó\.<\/strong> La solicitud ya fue revisada/],
    ['W13 422 del servidor', Respuesta(422, { error: 'Escribe por qué se rechaza.', tipo: 'FaltaMotivo', aprobada: false }), 'error', /No se aprobó\.<\/strong> Escribe por qué/],
    ['W14 501 sin sql/31', Respuesta(501, { error: 'Aprobar o rechazar todavía no está habilitado', tipo: 'RevisionNoDisponible' }), 'error', /todavía no está habilitado/],
    ['W15 403', Respuesta(403, { error: 'Solo un administrador (ADM) puede aprobar', tipo: 'RolInsuficiente' }), 'error', /Solo un administrador/],
    ['W16 500 sin confirmar (aprobada=null): aviso de revisar antes de reintentar', Respuesta(500, { error: 'No se pudo confirmar la revisión.', tipo: 'RevisionNoConfirmada', aprobada: null }), 'aviso', /No se pudo confirmar la revisión\. Revisa la solicitud antes de reintentar/]
  ];
  for (var e of errores) {
    w = MontarRev([e[1], Respuesta(200, LISTA), Respuesta(200, Detalle(9, { revision_disponible: true }))], Detalle(9, { revision_disponible: true }));
    await w.v.aprobar();
    Check(e[0], [e[2], true, 3, false], [w.$('snDetMsg').className.split(' ').pop(), e[3].test(w.$('snDetMsg').innerHTML), w.p.pedidas.length, w.v.ocupado]);
  }
  w = MontarRev([function () { return Promise.reject(new Error('red')); }], Detalle(9, { revision_disponible: true }));
  await w.v.aprobar();
  Check('W17 sin conexion: no se sabe; no relee a ciegas y se puede reintentar', ['aviso', true, 1, false],
    [w.$('snDetMsg').className.split(' ').pop(), /no se sabe si se aprobó/.test(w.$('snDetMsg').innerHTML), w.p.pedidas.length, w.v.ocupado]);

  // Doble clic: un solo envio.
  var soltar2;
  w = MontarRev([function () { return new Promise(function (ok) { soltar2 = ok; }); }, Respuesta(200, LISTA), Respuesta(200, Detalle(9, { revision_disponible: true }))],
                Detalle(9, { revision_disponible: true }));
  var p1 = w.v.aprobar();
  var p2 = await w.v.aprobar();
  var p3 = await w.v.rechazar();
  await new Promise(function (ok) { setTimeout(ok, 0); });
  soltar2({ status: 409, json: function () { return Promise.resolve({ aprobada: false, error: 'ya' }); } });
  await p1;
  Check('W18 doble clic / aprobar y rechazar a la vez: un solo POST', [null, 1], [p2, w.p.envios.length]);

  // Ya revisada en pantalla: no se manda nada.
  w = MontarRev([], Detalle(9, { estado: 'APROBADA', revision_disponible: true }));
  Check('W19 una solicitud ya revisada no se vuelve a mandar', [null, 0], [await w.v.aprobar(), w.p.pedidas.length]);

  // Clic en los botones del detalle (cableado).
  w = MontarRev([Respuesta(200, { aprobada: true }), Respuesta(200, LISTA), Respuesta(200, Detalle(9, { revision_disponible: true }))], Detalle(9, { revision_disponible: true }));
  w.v.cablear();
  w.$('snComentario').value = '';
  w.$('snDetalle').escuchas.click({ target: { closest: function () { return { getAttribute: function () { return 'aprobar'; } }; } } });
  await new Promise(function (ok) { setTimeout(ok, 10); });
  Check('W20 clic en Aprobar manda la aprobacion', 'accion=aprobar', (w.p.envios[0] || { url: '' }).url.split('?')[1]);

  // Aislamiento: nada de esta vista va al endpoint de Cambios.
  Check('W21 nunca se pide el endpoint de Cambios', [false, false, '../handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx'],
    [/admin_iniciativas_solicitudes\.ashx/.test(fs.readFileSync(path.join(raiz, 'admin', 'solicitudes-nuevas.js'), 'utf8')),
     [].concat(w.p.pedidas, m2.p.pedidas).some(function (u) { return u.indexOf(URL_CAMBIOS) >= 0; }), N.URL_REVISION]);

  // ---- la pagina ---------------------------------------------------------------
  // La pagina y su controlador estan en CRLF.
  var pagina = fs.readFileSync(path.join(raiz, 'admin', 'iniciativas.html'), 'utf8').replace(/\r\n/g, '\n');
  var scripts = pagina.match(/<script src="[^"]+"><\/script>/g).map(function (s) { return s.slice(13, -11); });
  Check('P1 el script va despues de solicitudes-cambio.js y antes de iniciativas.js', true,
    scripts.indexOf('solicitudes-cambio.js') < scripts.indexOf('solicitudes-nuevas.js') && scripts.indexOf('solicitudes-nuevas.js') < scripts.indexOf('iniciativas.js'));
  var panel = pagina.slice(pagina.indexOf('id="panel-solicitudes"'), pagina.indexOf('</section>\n\n  <!-- Administracion'));
  Check('P2 ids de Nuevas en la pestaña Solicitudes', [true, true, true, true, true, true, true],
    ['solVistas', 'solVerNuevas', 'solVerCambio', 'snBloque', 'snLista', 'snMsg', 'snDetalle'].map(function (id) { return panel.indexOf('id="' + id + '"') >= 0; }));
  Check('P3 "De cambio" intacta dentro de solVistaCambio: sus ids siguen ahi', [true, true, true, true, true, true],
    [/<div id="solVistaCambio">[\s\S]*<div id="solCola" hidden>[\s\S]*id="solFiltro"[\s\S]*id="solLista"[\s\S]*id="solDetalle"[\s\S]*<\/div>\s*<\/div>\s*<div class="ini-vacio" id="solNoAdm">/.test(panel),
     /id="solActualizar"/.test(panel), /id="solMsg"/.test(panel), /<option value="PENDIENTE" selected>Pendientes<\/option>/.test(panel),
     /id="solNoAdm"/.test(panel), /aria-pressed="true" aria-controls="solVistaCambio">Cambios<\/button>/.test(panel)]);
  Check('P3b rotulos del conmutador: "Iniciativas" y "Cambios" (los ids no cambian)', [true, true, false, false],
    [/id="solVerNuevas" aria-pressed="false" aria-controls="snBloque">Iniciativas<\/button>/.test(panel),
     /id="solVerCambio" aria-pressed="true" aria-controls="solVistaCambio">Cambios<\/button>/.test(panel),
     />Nuevas<\/button>/.test(panel), />De cambio<\/button>/.test(panel)]);
  Check('P4 conmutador y bloque nacen ocultos (solo ADM los muestra)', [true, true],
    [/id="solVistas" role="group" aria-label="Tipo de solicitud" hidden/.test(panel), /<div id="snBloque" hidden>/.test(panel)]);
  var pag = fs.readFileSync(path.join(raiz, 'admin', 'iniciativas.js'), 'utf8').replace(/\r\n/g, '\n');
  Check('P5 iniciativas.js abre Nuevas DESPUES de la cola y le pasa el rol', [true, true, true],
    [/this\.cola\.abrir\(\);\n\s*if \(nombre === 'solicitudes' && this\.nuevas\) this\.nuevas\.abrir\(\);/.test(pag),
     /this\.nuevas\.fijarRol\(this\.rol\)/.test(pag), /new window\.SolicitudesNuevas\.RegistroSolicitudesNuevas\(this\.doc, null\)/.test(pag)]);
  var cola = fs.readFileSync(path.join(raiz, 'admin', 'solicitudes-cambio.js'), 'utf8');
  Check('P6 solicitudes-cambio.js no conoce la vista nueva', false, /SolicitudesNuevas|solicitudes_nuevas|snBloque/.test(cola));

  console.log(fallos === 0 ? 'OK: todo paso' : 'FALLOS: ' + fallos);
  process.exit(fallos === 0 ? 0 : 1);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
