// tools/tests/AvisoSolicitudesSmoke.js - aviso rojo de la pestaña Solicitudes
// (admin/aviso-solicitudes.js) con un DOM minimo y un servidor falso que
// imita App_Code/SolicitudesVistas.cs: pendientes de las dos colas y lo
// visto POR USUARIO. Tambien que las colas (solicitudes-cambio.js,
// solicitudes-nuevas.js) avisan al abrir un detalle y al revisar.
//
//   node tools\tests\AvisoSolicitudesSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var raiz = path.join(__dirname, '..', '..');
var caja = { Promise: Promise, FormData: FormData, encodeURIComponent: encodeURIComponent, Date: Date, isNaN: isNaN, console: console, Math: Math };
caja.window = caja; caja.globalThis = caja;
['assets/js/escape.js', 'admin/aviso-solicitudes.js', 'admin/solicitudes-cambio.js', 'admin/solicitudes-nuevas.js'].forEach(function (f) {
  vm.runInNewContext(fs.readFileSync(path.join(raiz, f), 'utf8'), caja);
});
var A = caja.AvisoSolicitudes;

var fallos = 0;
function Check(titulo, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e !== o) fallos++;
  console.log((e === o ? 'PASS  ' : 'FAIL  ') + titulo + (e === o ? '' : '  esperado=' + e + '  obtenido=' + o));
}

function Elemento(id) {
  return { id: id, hidden: false, innerHTML: '', textContent: '', className: '', value: '', escuchas: {}, atributos: {},
    addEventListener: function (t, f) { this.escuchas[t] = f; },
    setAttribute: function (k, v) { this.atributos[k] = String(v); },
    removeAttribute: function (k) { delete this.atributos[k]; } };
}
function Documento() {
  var els = {};
  return { els: els, hidden: false,
    getElementById: function (id) { if (!els[id]) els[id] = Elemento(id); return els[id]; },
    querySelector: function () { return null; } };
}
function Respuesta(status, json) { return Promise.resolve({ status: status, json: function () { return Promise.resolve(json); } }); }
function campos(fd) { var c = {}; fd.forEach(function (v, k) { c[k] = v; }); return c; }
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

// Servidor falso: misma regla que AlmacenVistasSql (pendiente = PENDIENTE /
// ENVIADA; no vista = pendiente sin fila de ESE usuario; marcar solo inserta
// la fila del usuario y no toca el Estado).
function Servidor() {
  var s = {
    cambio: {}, nuevas: {}, vistas: {}, pedidos: [], vistasDisponibles: true, estadoResumen: 200,
    agregar: function (tipo, id) { (tipo === 'CAMBIO' ? s.cambio : s.nuevas)[id] = tipo === 'CAMBIO' ? 'PENDIENTE' : 'ENVIADA'; },
    resolver: function (tipo, id) { (tipo === 'CAMBIO' ? s.cambio : s.nuevas)[id] = tipo === 'CAMBIO' ? 'APLICADA' : 'RECHAZADA'; },
    resumen: function (u) {
      var p = 0, nv = 0;
      [['CAMBIO', s.cambio, 'PENDIENTE'], ['NUEVA', s.nuevas, 'ENVIADA']].forEach(function (c) {
        Object.keys(c[1]).forEach(function (id) {
          if (c[1][id] !== c[2]) return;
          p++;
          if (!s.vistas[u + '|' + c[0] + ':' + id]) nv++;
        });
      });
      return { pendientes: p, no_vistas: s.vistasDisponibles ? nv : null, vistas_disponibles: s.vistasDisponibles };
    },
    // pedir de un usuario (la identidad la pone el servidor, no el navegador).
    como: function (u) {
      return function (url, op) {
        s.pedidos.push({ u: u, url: url, metodo: op && op.method || 'GET' });
        if (url.indexOf('accion=resumen') >= 0) return s.estadoResumen === 200 ? Respuesta(200, s.resumen(u)) : Respuesta(s.estadoResumen, { error: 'x' });
        if (!s.vistasDisponibles) return Respuesta(501, { tipo: 'PersistenciaNoHabilitada' });
        var c = campos(op.body), tabla = c.tipo === 'CAMBIO' ? s.cambio : s.nuevas;
        if (!tabla[c.id]) return Respuesta(404, { error: 'no existe' });
        var k = u + '|' + c.tipo + ':' + c.id, nueva = !s.vistas[k];
        s.vistas[k] = true;
        return Respuesta(200, { vista: true, nueva: nueva });
      };
    },
    cuenta: function (metodo) { return s.pedidos.filter(function (p) { return p.metodo === metodo; }).length; }
  };
  return s;
}
function Pintado(doc) {
  var el = doc.getElementById('solAviso');
  return el.hidden ? 'oculto' : (el.className.indexOf('punto') >= 0 ? 'punto' : 'numero:' + el.textContent);
}

(async function () {
  // ---- E: estadoDe (las tres formas) ----
  Check('E1 sin pendientes: oculto', 'oculto', A.estadoDe({ pendientes: 0, no_vistas: 0 }).modo);
  Check('E2 pendientes con no vistas: numero', { modo: 'numero', n: 3 }, A.estadoDe({ pendientes: 5, no_vistas: 3 }));
  Check('E3 pendientes todas vistas: punto', 'punto', A.estadoDe({ pendientes: 2, no_vistas: 0 }).modo);
  Check('E4 sin sql/39 (no_vistas null): punto, nunca numero inventado', 'punto', A.estadoDe({ pendientes: 4, no_vistas: null }).modo);
  Check('E5 no vistas nunca pasa de pendientes', 2, A.estadoDe({ pendientes: 2, no_vistas: 9 }).n);
  Check('E6 sin respuesta: oculto', 'oculto', A.estadoDe(null).modo);
  Check('E7 mas de 99: 99+', '99+', A.textoNumero(150));

  // ---- F: el flujo del pedido (3 llegan, se ven, se resuelven) ----
  var srv = Servidor(), doc = Documento();
  var ana = new A.Aviso(doc, srv.como('soriana\\ana'));
  await ana.fijarRol('ADM');
  Check('F1 sin pendientes: oculto', 'oculto', Pintado(doc));
  srv.agregar('CAMBIO', 41); srv.agregar('CAMBIO', 42); srv.agregar('NUEVA', 7);
  await ana.actualizar();
  Check('F2 llegan 3: circulo con 3', 'numero:3', Pintado(doc));
  Check('F3 etiqueta accesible en la pestaña', 'Solicitudes, 3 sin ver de 3 pendientes', doc.getElementById('tab-solicitudes').atributos['aria-label']);
  await ana.marcar('CAMBIO', 41, 'PENDIENTE');
  Check('F4 ve una: 2', 'numero:2', Pintado(doc));
  await ana.marcar('CAMBIO', 42, 'PENDIENTE');
  await ana.marcar('NUEVA', 7, 'ENVIADA');
  Check('F5 ve las 3: punto sin numero', 'punto', Pintado(doc));
  Check('F6 marcar no cambia el Estado', ['PENDIENTE', 'PENDIENTE', 'ENVIADA'], [srv.cambio[41], srv.cambio[42], srv.nuevas[7]]);
  srv.resolver('CAMBIO', 41); srv.resolver('CAMBIO', 42); srv.resolver('NUEVA', 7);
  await ana.actualizar();
  Check('F7 todas resueltas: desaparece', 'oculto', Pintado(doc));
  Check('F8 sin etiqueta extra al ocultar', undefined, doc.getElementById('tab-solicitudes').atributos['aria-label']);

  // ---- R: una no vista que se resuelve deja de contar en las dos ----
  srv.agregar('CAMBIO', 50); srv.agregar('CAMBIO', 51);
  await ana.actualizar();
  Check('R1 dos nuevas: 2', 'numero:2', Pintado(doc));
  srv.resolver('CAMBIO', 50);
  await ana.actualizar();
  Check('R2 se resuelve una sin verla: 1 (no queda en ninguna cuenta)', ['numero:1', 1], [Pintado(doc), ana.resumen.pendientes]);
  await ana.marcar('CAMBIO', 51, 'PENDIENTE');
  srv.resolver('CAMBIO', 51);
  await ana.actualizar();
  Check('R3 vista y resuelta: desaparece', 'oculto', Pintado(doc));

  // ---- U: por revisor ----
  var srv2 = Servidor(), docA = Documento(), docB = Documento();
  srv2.agregar('CAMBIO', 1); srv2.agregar('NUEVA', 2);
  var a = new A.Aviso(docA, srv2.como('soriana\\ana')), b = new A.Aviso(docB, srv2.como('soriana\\beto'));
  await a.fijarRol('ADM'); await b.fijarRol('ADM');
  await a.marcar('CAMBIO', 1, 'PENDIENTE'); await a.marcar('NUEVA', 2, 'ENVIADA');
  await b.actualizar();
  Check('U1 Ana las vio todas: punto; Beto sigue con 2', ['punto', 'numero:2'], [Pintado(docA), Pintado(docB)]);
  await b.marcar('NUEVA', 2, 'ENVIADA');
  await a.actualizar();
  Check('U2 lo que ve Beto no cambia a Ana', ['punto', 'numero:1'], [Pintado(docA), Pintado(docB)]);

  // ---- M: que se marca y cuantas peticiones ----
  var srv3 = Servidor(), doc3 = Documento();
  srv3.agregar('CAMBIO', 9); srv3.agregar('NUEVA', 3);
  srv3.resolver('NUEVA', 3);
  var m = new A.Aviso(doc3, srv3.como('soriana\\ana'));
  await m.fijarRol('ADM');
  Check('M1 abrir una resuelta no la marca', [false, 0], [await m.marcar('NUEVA', 3, 'RECHAZADA'), srv3.cuenta('POST')]);
  Check('M2 estado de la otra cola no cuenta (ENVIADA en CAMBIO)', false, await m.marcar('CAMBIO', 9, 'ENVIADA'));
  await m.marcar('CAMBIO', 9, 'PENDIENTE');
  await m.marcar('CAMBIO', 9, 'PENDIENTE');
  Check('M3 la misma dos veces: un solo POST', 1, srv3.cuenta('POST'));
  var antes = srv3.cuenta('GET');
  var p1 = m.actualizar(), p2 = m.actualizar(), p3 = m.actualizar();
  await Promise.all([p1, p2, p3]);
  Check('M4 tres actualizar a la vez: una en vuelo + una relectura (2 GET, no 3)', 2, srv3.cuenta('GET') - antes);
  var docMod = Documento(), nadie = new A.Aviso(docMod, srv3.como('soriana\\mod'));
  antes = srv3.pedidos.length;
  await nadie.fijarRol('MOD');
  await nadie.actualizar();
  Check('M5 MOD (no revisa): ni una peticion, oculto', [0, 'oculto'], [srv3.pedidos.length - antes, Pintado(docMod)]);
  antes = srv3.cuenta('GET');
  await m.fijarRol('ADM');
  Check('M6 fijarRol(ADM) de nuevo (revisarSesion): no relee', 0, srv3.cuenta('GET') - antes);

  // ---- D: degradacion ----
  var srv4 = Servidor(), doc4 = Documento();
  srv4.vistasDisponibles = false;
  srv4.agregar('CAMBIO', 1);
  var d = new A.Aviso(doc4, srv4.como('soriana\\ana'));
  await d.fijarRol('ADM');
  Check('D1 sin sql/39: punto (hay pendientes), sin numero', 'punto', Pintado(doc4));
  Check('D2 marcar con 501: false y no insiste', [false, true], [await d.marcar('CAMBIO', 1, 'PENDIENTE'), d.sinVistas]);
  srv4.vistasDisponibles = true;
  srv4.estadoResumen = 500;
  await d.actualizar();
  Check('D3 un 500 deja lo ultimo pintado', 'punto', Pintado(doc4));
  srv4.estadoResumen = 403;
  Check('D4 403: lo quita y devuelve 403 (RefrescoAuto se detiene)', [403, 'oculto'], [await d.actualizar(), Pintado(doc4)]);
  srv4.estadoResumen = 200;
  await d.actualizar();
  await d.fijarRol(null);
  Check('D5 pierde ADM: oculto', 'oculto', Pintado(doc4));

  // ---- H: las colas avisan ----
  var docH = Documento(), vistos = [], revisados = 0;
  var cola = new caja.SolicitudesCambioCola.ColaSolicitudes(docH, function (url) {
    if (url.indexOf('accion=detalle') >= 0) return Respuesta(200, { id: 41, estado: 'PENDIENTE', tipo: 'OTROS', motivo: 'x', categorias_detalle: [], eventos: [] });
    if (url.indexOf('accion=rechazar') >= 0) return Respuesta(200, { rechazada: true });
    return Respuesta(200, { solicitudes: [] });
  });
  cola.alVerSolicitud = function (x) { vistos.push(['CAMBIO', x.id, x.estado]); };
  cola.alRevisar = function () { revisados++; };
  await cola.verDetalle(41);
  docH.getElementById('solComentario').value = 'no procede';
  await cola.rechazar();
  await esperar();
  Check('H1 cola de cambios: abrir avisa con id y estado; rechazar avisa', [['CAMBIO', 41, 'PENDIENTE'], 1], [vistos[0], revisados]);
  var nuevas = new caja.SolicitudesNuevas.RegistroSolicitudesNuevas(docH, function (url) {
    if (url.indexOf('accion=detalle') >= 0) return Respuesta(200, { numero: 7, numero_texto: 'SOL-0000007', estado: 'ENVIADA', eventos: [] });
    return Respuesta(200, { rechazada: true, solicitudes: [] });
  });
  nuevas.alVerSolicitud = function (x) { vistos.push(['NUEVA', x.numero, x.estado]); };
  nuevas.alRevisar = function () { revisados++; };
  await nuevas.verDetalle(7);
  docH.getElementById('snComentario').value = 'duplicada';
  await nuevas.rechazar();
  await esperar();
  Check('H2 nuevas: abrir avisa con numero y estado; rechazar avisa', [['NUEVA', 7, 'ENVIADA'], 2], [vistos.filter(function (v) { return v[0] === 'NUEVA'; })[0], revisados]);

  // ---- C: la pagina carga el modulo y el marcado existe ----
  var html = fs.readFileSync(path.join(raiz, 'admin', 'iniciativas.html'), 'utf8');
  Check('C1 marcado del aviso dentro de la pestaña y script cargado', [true, true],
    [/id="tab-solicitudes"[^>]*>Solicitudes<span class="ini-tab-aviso" id="solAviso" aria-hidden="true" hidden><\/span><\/button>/.test(html),
     html.indexOf('<script src="aviso-solicitudes.js"></script>') > html.indexOf('<script src="solicitudes-nuevas.js"></script>')]);

  console.log(fallos ? fallos + ' FALLO(S)' : 'Todo bien.');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.error(e); process.exit(1); });
