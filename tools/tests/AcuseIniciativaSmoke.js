/* =========================================================================
   tools/tests/AcuseIniciativaSmoke.js

   Prueba en node de admin/acuse-iniciativa.js (acuse del PO / SO y avisos
   de ADM), sin navegador ni servidor. Datos sinteticos.

   Casos:
     E) quien ve el boton: solo con roles del servidor (accion=mio) Y
        Atrasada del semaforo (Registro.semaforoFecha): no en tiempo, sin
        fecha, sin control de fecha ni cerrada; PO y SO por separado; sin
        sql/28 nada; el episodio (fecha compromiso) decide "ya registrado".
     D) AcuseDetalle: pide mio una vez y los acuses del folio; el POST solo
        lleva folio y rol (ninguna cuenta ni nombre); doble clic = un POST;
        respuesta nueva / repetida / error; respuesta de otro detalle se
        descarta.
     B) VistaAvisosAcuse: cargar NO marca nada (solo GET); no leidas;
        "Marcar como leido" = un POST con el id y baja la cuenta; "Ver" abre
        el detalle; sin sql/28 lo dice; error.
     H) HTML: seccion data-solo-adm oculta en Administracion; script
        despues de registro-iniciativas.js.

   Correr: node tools/tests/AcuseIniciativaSmoke.js
   ========================================================================= */
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8'); }

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

function Elemento(id) {
  var oyentes = {}, atributos = {};
  return {
    id: id, textContent: '', hidden: false, innerHTML: '', disabled: false,
    setAttribute: function (k, v) { atributos[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(atributos, k) ? atributos[k] : null; },
    closest: function () { return this; },
    addEventListener: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    disparar: function (tipo, evento) { var self = this; (oyentes[tipo] || []).forEach(function (fn) { fn(evento || { target: self }); }); }
  };
}
function Documento() {
  var els = {};
  return { getElementById: function (id) { return els[id] || (els[id] = Elemento(id)); } };
}
function Respuesta(status, json) { return { status: status, ok: status >= 200 && status < 300, json: function () { return Promise.resolve(json); } }; }
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

var ventana = {};
(new Function('window', leer('assets/js/escape.js')))(ventana);
(new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
(new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', 'fetch', leer('admin/registro-iniciativas.js')))(
  ventana, Documento(), {}, ventana.Escape, {}, function () { return new Promise(function () {}); });
(new Function('window', 'Escape', 'fetch', leer('admin/acuse-iniciativa.js')))(ventana, ventana.Escape, function () { throw new Error('fetch real'); });
var A = ventana.AcuseIniciativa;

// Iniciativas con la forma del registro.
function Ini(folio, o) {
  var i = { folio: folio, titulo: 'T ' + folio, estado: 'En Solución', activa: true, control_fecha: true, fecha_retrasada: true,
            f_analisis: null, f_solucion: '2026-09-01', f_cierre: null };
  Object.keys(o || {}).forEach(function (k) { i[k] = o[k]; });
  return i;
}
var ATRASADA = Ini('PRB 2026-000001');
var EN_TIEMPO = Ini('PRB 2026-000002', { fecha_retrasada: false });
var SIN_CONTROL = Ini('REQ 2026-000003', { control_fecha: false });
var CERRADA = Ini('PRB 2026-000004', { estado: 'Cerrado', activa: false });
var SIN_FECHA = Ini('PRB 2026-000005', { f_solucion: null, fecha_retrasada: false });
var MIO = { disponible: true, identidad: { estado: 'resuelto', nombre: 'Jesus Campa Morones' },
            roles: { 'PRB 2026-000001': ['PO', 'SO'], 'PRB 2026-000002': ['PO'], 'REQ 2026-000003': ['PO'], 'PRB 2026-000004': ['PO'], 'PRB 2026-000005': ['PO'] } };

// ---- E: quien ve el boton ----
Check('E1 Atrasada y dueño de los dos roles: PO y SO por separado', ['PO', 'SO'], A.rolesAcusables(ATRASADA, MIO));
Check('E2 en tiempo / sin control de fecha / cerrada / sin fecha: nada', [[], [], [], []],
  [EN_TIEMPO, SIN_CONTROL, CERRADA, SIN_FECHA].map(function (i) { return A.rolesAcusables(i, MIO); }));
Check('E3 sin rol del servidor para ese folio: nada', [], A.rolesAcusables(Ini('PRB 2026-000099'), MIO));
Check('E4 sin sql/28 o sin respuesta: nada (ni html)', [[], [], ''],
  [A.rolesAcusables(ATRASADA, { disponible: false, roles: MIO.roles }), A.rolesAcusables(ATRASADA, null), A.htmlDetalle(ATRASADA, { disponible: false }, [], null, null)]);
var html = A.htmlDetalle(ATRASADA, MIO, [], null, null);
Check('E5 dos botones con su rol, y la nota de que no cambia nada', [2, true, true, true],
  [(html.match(/data-acuse-rol=/g) || []).length, /Estoy trabajando en ello \(Product Owner\)/.test(html),
   /Estoy trabajando en ello \(Service Owner\)/.test(html), /No cambia el estado, las fechas ni el semáforo/.test(html)]);
var ya = [{ id: 1, rol: 'PO', nombre: 'Jesus <b>', fecha_compromiso: '2026-09-01', fecha_utc: '2026-10-22T15:00:00Z' },
          { id: 2, rol: 'SO', nombre: 'Edgar', fecha_compromiso: '2026-08-01', fecha_utc: '2026-10-01T15:00:00Z' }];
html = A.htmlDetalle(ATRASADA, MIO, ya, null, null);
Check('E6 PO ya acusado en ESTE episodio: sin boton PO; SO de otro episodio: boton SO; lista escapada', [false, true, true, true, false],
  [/data-acuse-rol="PO"/.test(html), /data-acuse-rol="SO"/.test(html), /Registraste que estás trabajando en ella como Product Owner/.test(html),
   /Jesus &lt;b&gt;/.test(html), html.indexOf('Jesus <b>') >= 0]);
Check('E7 sin fecha compromiso: el episodio es null', true,
  !!A.acuseVigente([{ rol: 'PO', fecha_compromiso: null }], 'PO', null));
html = A.htmlDetalle(EN_TIEMPO, MIO, ya, null, null);
Check('E8 no atrasada pero con acuses: solo la lista, sin botones', [false, true], [/data-acuse-rol/.test(html), /Acuses de los dueños/.test(html)]);
Check('E9 no dueño, no atrasada y sin acuses: nada', '', A.htmlDetalle(EN_TIEMPO, { disponible: true, roles: {} }, [], null, null));

// ---- D: AcuseDetalle ----
function Pedidos(respuestas) {
  var pedidos = [];
  var pedir = function (url, op) {
    pedidos.push({ url: url, op: op || {} });
    for (var k = 0; k < respuestas.length; k++) {
      if (respuestas[k][0].test(url)) {
        var r = respuestas[k][1];
        return typeof r === 'function' ? r(url, op) : Promise.resolve(r);
      }
    }
    return Promise.resolve(Respuesta(404, {}));
  };
  return { pedir: pedir, pedidos: pedidos };
}
var pruebas = [];

pruebas.push(function () {
  var acuses = [];
  var soltar = null;
  var p = Pedidos([
    [/accion=mio/, Respuesta(200, MIO)],
    [/accion=iniciativa/, function () { return Promise.resolve(Respuesta(200, { disponible: true, acuses: acuses.slice() })); }],
    [/accion=acusar/, function (url, op) {
      return new Promise(function (ok) {
        soltar = function () {
          acuses.push({ id: 1, rol: 'PO', nombre: 'Jesus Campa Morones', fecha_compromiso: '2026-09-01', fecha_utc: '2026-10-22T15:00:00Z' });
          ok(Respuesta(200, { acusado: true, nuevo: true, id: 1, rol: 'PO', fecha_utc: '2026-10-22T15:00:00Z' }));
        };
      });
    }]
  ]);
  var det = new A.AcuseDetalle(Documento(), p.pedir);
  var caja = Elemento('regAcuse');
  return det.mostrar(ATRASADA, caja).then(function () {
    Check('D1 al abrir: pide mio y los acuses del folio; pinta dos botones', [2, false, 2],
      [p.pedidos.length, caja.hidden, (caja.innerHTML.match(/data-acuse-rol=/g) || []).length]);
    var b = Elemento('b'); b.setAttribute('data-acuse-rol', 'PO');
    caja.disparar('click', { target: b });
    var enviando = [/Registrando…/.test(caja.innerHTML), /disabled/.test(caja.innerHTML)];
    caja.disparar('click', { target: b });
    return esperar().then(function () {
      var posts = p.pedidos.filter(function (x) { return x.op.method === 'POST'; });
      Check('D2 doble clic: un solo POST; boton deshabilitado "Registrando…"', [1, true, true], [posts.length].concat(enviando));
      Check('D3 el POST lleva SOLO folio y rol (ninguna cuenta, usuario ni nombre)', 'folio=PRB%202026-000001&rol=PO', posts[0].op.body);
      soltar();
      return esperar().then(esperar).then(esperar);
    });
  }).then(function () {
    Check('D4 registrado: aviso, lista con el acuse, sin boton PO (sigue SO)', [true, true, false, true],
      [/<strong>Registrado.<\/strong>/.test(caja.innerHTML), /Acuses de los dueños/.test(caja.innerHTML),
       /data-acuse-rol="PO"/.test(caja.innerHTML), /data-acuse-rol="SO"/.test(caja.innerHTML)]);
    var p2 = Pedidos([
      [/accion=mio/, Respuesta(200, MIO)], [/accion=iniciativa/, Respuesta(200, { disponible: true, acuses: [] })],
      [/accion=acusar/, Respuesta(403, { error: 'Solo el Product Owner asignado a esta iniciativa puede acusarla en ese rol.', tipo: 'NoEsDueno' })]
    ]);
    var det2 = new A.AcuseDetalle(Documento(), p2.pedir), caja2 = Elemento('regAcuse');
    return det2.mostrar(ATRASADA, caja2).then(function () { return det2.acusar('PO'); }).then(function () {
      Check('D5 el servidor rechaza: "No se registró" con su mensaje; el boton vuelve', [true, true, true],
        [/No se registró/.test(caja2.innerHTML), /Solo el Product Owner asignado/.test(caja2.innerHTML), /data-acuse-rol="PO"/.test(caja2.innerHTML)]);
      var p3 = Pedidos([[/accion=mio/, Respuesta(200, MIO)], [/accion=iniciativa/, Respuesta(200, { disponible: true, acuses: [] })],
        [/accion=acusar/, Respuesta(200, { acusado: true, nuevo: false, fecha_utc: '2026-10-22T15:00:00Z' })]]);
      var det3 = new A.AcuseDetalle(Documento(), p3.pedir), caja3 = Elemento('regAcuse');
      return det3.mostrar(ATRASADA, caja3).then(function () { return det3.acusar('PO'); }).then(function () {
        Check('D6 repetido en el servidor: "Ya estaba registrado"', true, /Ya estaba registrado/.test(caja3.innerHTML));
      });
    });
  });
});

pruebas.push(function () {
  // Una respuesta lenta del detalle anterior no pinta en el nuevo.
  var lenta = null;
  var p = Pedidos([[/accion=mio/, Respuesta(200, MIO)],
    [/PRB%202026-000001/, function () { return new Promise(function (ok) { lenta = ok; }); }],
    [/accion=iniciativa/, Respuesta(200, { disponible: true, acuses: [] })]]);
  var det = new A.AcuseDetalle(Documento(), p.pedir);
  var c1 = Elemento('regAcuse'), c2 = Elemento('regAcuse');
  det.mostrar(ATRASADA, c1);
  return det.mostrar(EN_TIEMPO, c2).then(function () {
    lenta(Respuesta(200, { disponible: true, acuses: [] }));
    return esperar();
  }).then(function () {
    Check('D7 respuesta superada se descarta; el nuevo (en tiempo, sin acuses) queda oculto', [true, '', true],
      [c1.hidden, c1.innerHTML, c2.hidden]);
    Check('D8 mio se pide una sola vez por pagina', 1, p.pedidos.filter(function (x) { return /accion=mio/.test(x.url); }).length);
  });
});

// ---- B: avisos de ADM ----
pruebas.push(function () {
  var datos = { disponible: true, no_leidas: 2, notificaciones: [
    { id_notificacion: 2, folio: 'PRB 2026-000001', rol: 'SO', nombre: 'Edgar', cuenta: 'SORIANA\\edgarrad', fecha_utc: '2026-10-22T16:00:00Z', fecha_compromiso: '2026-09-01', leida: false },
    { id_notificacion: 1, folio: 'PRB 2026-000009', rol: 'PO', nombre: 'Jesus', cuenta: 'SORIANA\\jesuscamor', fecha_utc: '2026-10-22T15:00:00Z', fecha_compromiso: null, leida: false }
  ] };
  var p = Pedidos([[/accion=bandeja/, function () { return Promise.resolve(Respuesta(200, JSON.parse(JSON.stringify(datos)))); }],
                   [/accion=leida/, Respuesta(200, { leida: true, id_notificacion: 2, nueva: true })]]);
  var abiertos = [];
  var doc = Documento();
  var reg = { buscar: function (f) { return f === 'PRB 2026-000001' ? { folio: f, titulo: 'Uno' } : null; } };
  var v = new A.VistaAvisosAcuse(doc, p.pedir, function () { return reg; }, function (f) { abiertos.push(f); });
  return v.abrir().then(function () { return v.cargar(); }).then(function () {
    var lista = doc.getElementById('avLista').innerHTML;
    Check('B1 cargar dos veces: solo GET (no marca nada); 2 sin leer; dos filas "Nuevo"', [0, '2 sin leer', 2, false],
      [p.pedidos.filter(function (x) { return x.op.method === 'POST'; }).length, doc.getElementById('avNoLeidas').textContent,
       (lista.match(/Nuevo/g) || []).length, doc.getElementById('avLista').hidden]);
    Check('B2 fila: titulo del registro, persona, rol, cuenta; folio fuera del registro sin "Ver"', [true, true, true, false],
      [/Uno/.test(lista), /Service Owner · SORIANA\\edgarrad/.test(lista), /No está en el registro cargado/.test(lista), /data-av-folio="PRB 2026-000009"/.test(lista)]);
    var b = Elemento('b'); b.setAttribute('data-av-leida', '2');
    doc.getElementById('avLista').disparar('click', { target: b });
    return esperar();
  }).then(function () {
    var posts = p.pedidos.filter(function (x) { return x.op.method === 'POST'; });
    Check('B3 marcar leido: un POST con el id; baja a "1 sin leer"; la fila dice "Leído"', [1, 'id=2', '1 sin leer', true],
      [posts.length, posts[0].op.body, doc.getElementById('avNoLeidas').textContent, /Leído/.test(doc.getElementById('avLista').innerHTML)]);
    var ver = Elemento('v'); ver.setAttribute('data-av-folio', 'PRB 2026-000001');
    doc.getElementById('avLista').disparar('click', { target: ver });
    Check('B4 "Ver" abre el detalle de ese folio', ['PRB 2026-000001'], abiertos);
    var q = Pedidos([[/accion=bandeja/, Respuesta(200, { disponible: false })]]);
    var d2 = Documento();
    var v2 = new A.VistaAvisosAcuse(d2, q.pedir);
    return v2.abrir().then(function () {
      Check('B5 sin sql/28: lo dice; sin cuenta', [false, 'El acuse de los dueños todavía no está habilitado en la base de datos.', ''],
        [d2.getElementById('avVacio').hidden, d2.getElementById('avVacioTexto').textContent, d2.getElementById('avNoLeidas').textContent]);
      var r = Pedidos([[/accion=bandeja/, Respuesta(403, { error: 'Solo un administrador (ADM) ve los avisos de los dueños.' })]]);
      var d3 = Documento();
      return new A.VistaAvisosAcuse(d3, r.pedir).abrir().then(function () {
        Check('B6 403: error visible, no lista vacia', [false, true], [d3.getElementById('avError').hidden, d3.getElementById('avLista').hidden]);
      });
    });
  });
});

// ---- H: HTML ----
pruebas.push(function () {
  var html = leer('admin/iniciativas.html');
  // Oculto pendiente de aprobacion: el script lo dice y la pagina no lo conecta.
  Check('Z1 AcuseIniciativa.HABILITADO = false (oculto pendiente de aprobacion)', false, A.HABILITADO);
  var pag = leer('admin/iniciativas.js');
  Check('Z2 la pagina conecta acuse y avisos SOLO con HABILITADO; si no, quita data-solo-adm de la seccion', [true, true],
    [/if \(window\.AcuseIniciativa && window\.AcuseIniciativa\.HABILITADO\) \{\s*var clienteAcuse/.test(pag),
     /!window\.AcuseIniciativa\.HABILITADO\) \{\s*var avSeccion = this\.\$\('avSeccion'\);\s*if \(avSeccion\) \{ avSeccion\.removeAttribute\('data-solo-adm'\); avSeccion\.hidden = true; \}/.test(pag)]);
  Check('H1 seccion de avisos solo ADM, oculta, en Administracion antes de Cambios recientes', true,
    /<section class="ini-adm-bloque ini-av" id="avSeccion" aria-labelledby="avTitulo" data-solo-adm hidden>[\s\S]*id="crSeccion"/.test(html));
  Check('H2 script despues de registro-iniciativas.js', true,
    html.indexOf('<script src="acuse-iniciativa.js">') > html.indexOf('<script src="registro-iniciativas.js">'));
});

pruebas.reduce(function (c, p) { return c.then(p); }, Promise.resolve()).then(function () {
  console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nOK: todo paso');
  process.exit(fallos ? 1 : 0);
}, function (err) { console.log('ERROR ' + (err && err.stack || err)); process.exit(1); });
