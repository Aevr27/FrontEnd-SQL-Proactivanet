// tools/tests/SolicitudesNuevasSmoke.js - la vista "Nuevas" de la pestaña
// Solicitudes (admin/solicitudes-nuevas.js): lo que se pinta (lista,
// detalle con historial, escape), cada respuesta dicha distinto (cargando,
// vacio, 501 sin tablas, 403, 500 de la base, sin conexion), el conmutador
// "Nuevas | De cambio" por rol, y que la pagina la monta sin mover "De cambio".
//
//   node tools\tests\SolicitudesNuevasSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var raiz = path.join(__dirname, '..', '..');
var caja = { Promise: Promise, encodeURIComponent: encodeURIComponent, Date: Date, isNaN: isNaN, console: console };
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
