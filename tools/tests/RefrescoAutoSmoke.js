// Prueba en node del refresco automatico de la pestaña Solicitudes:
// assets/js/refresco-auto.js (RefrescoAuto, con reloj y documento falsos) y
// el listar(fondo) / puedeRefrescar de admin/solicitudes-nuevas.js y
// admin/solicitudes-cambio.js, con su fetch falso.
//
//   T  temporizador: una vuelta por intervalo; pagina oculta no pide; sin
//      encimarse; 401 / 403 lo detienen; al volver a visible refresca si ya
//      paso el intervalo; puede() = false no pide; iniciar dos veces no
//      duplica.
//   L  listas: una respuesta vieja no pisa a la nueva (filtro / Actualizar
//      despues); en fondo una falla NO borra la lista y lo dice discreto;
//      sin "Cargando…"; 403 en fondo sigue el camino de siempre; el filtro
//      elegido se conserva.
//   P  puedeRefrescar: no con detalle abierto, con alguien escribiendo o
//      eligiendo, con revision en curso, con la vista / pestaña oculta.
//   W  la pagina carga el script y arma UN RefrescoAuto para las tres listas.
//
//   node tools\tests\RefrescoAutoSmoke.js   # sale 0 si todo paso
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

// ---- documento y elementos falsos ----
function Elemento(id) {
  var oy = {};
  return { id: id, hidden: false, innerHTML: '', textContent: '', className: '', value: '', tagName: 'DIV', hijos: [],
    addEventListener: function (t, f) { (oy[t] = oy[t] || []).push(f); },
    disparar: function (t, e) { (oy[t] || []).forEach(function (f) { f(e || { target: this }); }, this); },
    setAttribute: function () {}, getAttribute: function () { return null; },
    contains: function (o) { return o === this || this.hijos.indexOf(o) >= 0; } };
}
function Documento() {
  var els = {}, oy = {};
  return { els: els, hidden: false, activeElement: null,
    getElementById: function (id) { if (!els[id]) els[id] = Elemento(id); return els[id]; },
    addEventListener: function (t, f) { (oy[t] = oy[t] || []).push(f); },
    removeEventListener: function (t, f) { oy[t] = (oy[t] || []).filter(function (g) { return g !== f; }); },
    disparar: function (t) { (oy[t] || []).slice().forEach(function (f) { f(); }); },
    oyentes: function (t) { return (oy[t] || []).length; } };
}
// Reloj manual: avanzar(ms) corre lo programado que ya vencio.
function Reloj() {
  var r = { t: 0, cola: [], sig: 1 };
  r.ahora = function () { return r.t; };
  r.programar = function (fn, ms) { var id = r.sig++; r.cola.push({ id: id, en: r.t + ms, fn: fn }); return id; };
  r.cancelar = function (id) { r.cola = r.cola.filter(function (x) { return x.id !== id; }); };
  r.avanzar = function (ms) {
    r.t += ms;
    var vencidas = r.cola.filter(function (x) { return x.en <= r.t; });
    r.cola = r.cola.filter(function (x) { return x.en > r.t; });
    vencidas.forEach(function (x) { x.fn(); });
  };
  r.pendientes = function () { return r.cola.length; };
  return r;
}
function Respuesta(status, json) { return Promise.resolve({ status: status, json: function () { return Promise.resolve(json); } }); }
function Diferida() { var d = {}; d.promesa = new Promise(function (res) { d.resolver = res; }); return d; }

var caja = { Promise: Promise, encodeURIComponent: encodeURIComponent, Date: Date, isNaN: isNaN, console: console,
             setTimeout: setTimeout, clearTimeout: clearTimeout, FormData: FormData };
caja.window = caja; caja.globalThis = caja;
vm.runInNewContext(leer('assets/js/escape.js'), caja);
vm.runInNewContext(leer('assets/js/refresco-auto.js'), caja);
vm.runInNewContext(leer('admin/solicitudes-cambio.js'), caja);
vm.runInNewContext(leer('admin/solicitudes-nuevas.js'), caja);
var RA = caja.RefrescoAuto;

(async function () {
  // ================= T) temporizador =================
  var reloj = Reloj(), doc = Documento(), llamadas = 0, puede = true, respuesta = 200, pendiente = null;
  var r = new RA({ intervalo: 1000, doc: doc, reloj: reloj, puede: function () { return puede; },
    refrescar: function () { llamadas++; return pendiente ? pendiente.promesa : Promise.resolve(respuesta); } }).iniciar();
  r.iniciar();
  Check('T0 iniciar dos veces: un solo temporizador y un solo oyente de visibilidad', [1, 1], [reloj.pendientes(), doc.oyentes('visibilitychange')]);
  reloj.avanzar(999); await tics();
  Check('T1 antes del intervalo no pide', 0, llamadas);
  reloj.avanzar(1); await tics();
  Check('T1 al cumplirse pide una vez y deja programada la siguiente', [1, 1], [llamadas, reloj.pendientes()]);
  doc.hidden = true;
  reloj.avanzar(1000); await tics();
  Check('T2 pagina oculta: no pide (y sigue programado)', [1, 1], [llamadas, reloj.pendientes()]);
  reloj.avanzar(5000); await tics();
  doc.hidden = false; doc.disparar('visibilitychange'); await tics();
  Check('T3 al volver a visible, con el intervalo vencido, pide en ese momento', 2, llamadas);
  doc.disparar('visibilitychange'); await tics();
  Check('T3 ... y no otra vez enseguida', 2, llamadas);
  puede = false;
  reloj.avanzar(1000); await tics();
  Check('T4 puede() = false (detalle abierto, escribiendo...): no pide', 2, llamadas);
  puede = true;
  pendiente = Diferida();
  reloj.avanzar(1000); await tics();
  Check('T5 empieza una lectura lenta', 3, llamadas);
  r.vuelta(); r.vuelta(); await tics();
  reloj.avanzar(3000); await tics();
  Check('T5 mientras no termina no se encima ninguna otra', 3, llamadas);
  pendiente.resolver(200); pendiente = null; await tics();
  reloj.avanzar(1000); await tics();
  Check('T5 al terminar sigue el ritmo normal', 4, llamadas);
  respuesta = 403;
  reloj.avanzar(1000); await tics();
  Check('T6 un 403 lo detiene: sin temporizador ni oyente, y dice por que', [5, 0, 0, false, 403],
    [llamadas, reloj.pendientes(), doc.oyentes('visibilitychange'), r.activo, r.detenidoPor]);
  reloj.avanzar(10000); await tics();
  Check('T6 ... y no vuelve a pedir', 5, llamadas);
  var r401 = new RA({ intervalo: 10, doc: Documento(), reloj: reloj, refrescar: function () { return Promise.resolve(401); } }).iniciar();
  reloj.avanzar(10); await tics();
  Check('T6 un 401 tambien', [false, 401], [r401.activo, r401.detenidoPor]);
  var rErr = new RA({ intervalo: 10, doc: Documento(), reloj: reloj, refrescar: function () { return Promise.reject(new Error('red')); } }).iniciar();
  reloj.avanzar(10); await tics();
  Check('T7 una falla de red no lo detiene', true, rErr.activo);
  rErr.detener(); r401.detener();
  Check('T8 intervalo por omision: 2 minutos', 120000, RA.INTERVALO);

  // ================= L) listas =================
  function Cola(pedir) {
    var d = Documento();
    var c = new caja.SolicitudesCambioCola.ColaSolicitudes(d, pedir);
    c.fijarRol('ADM'); c.cablear();
    return { c: c, d: d, $: function (id) { return d.getElementById(id); } };
  }
  var FILA = function (id) { return { id: id, folio: 'PRB 2026-00000' + id, tipo: 'OTROS', estado: 'PENDIENTE', solicitado_por: 'x', rol_solicitante: 'MOD' }; };
  var cola = [];
  var x = Cola(function (url) { var d = Diferida(); cola.push({ url: url, d: d }); return d.promesa.then(function (a) { return Respuesta(a[0], a[1]); }); });
  var vieja = x.c.listar(true);
  x.c.filtro = 'APLICADA';
  var nueva = x.c.listar();
  await tics();
  cola[1].d.resolver([200, { solicitudes: [FILA(2)] }]); await nueva;
  cola[0].d.resolver([200, { solicitudes: [FILA(1)] }]); await vieja;
  Check('L1 la respuesta vieja (fondo) no pisa a la nueva (filtro cambiado)', [true, false, true],
    [/data-sol-id="2"/.test(x.$('solLista').innerHTML), /data-sol-id="1"/.test(x.$('solLista').innerHTML), /estado=APLICADA/.test(cola[1].url)]);
  x.c.listar(true); await tics();
  Check('L1 el filtro elegido se conserva en el refresco', true, /estado=APLICADA/.test(cola[2].url));
  cola[2].d.resolver([200, { solicitudes: [FILA(2)] }]); await tics();

  var resp = [];
  var y = Cola(function () { return resp.shift(); });
  resp.push(Respuesta(200, { solicitudes: [FILA(7)] })); await y.c.listar();
  var antes = y.$('solLista').innerHTML;
  y.c.mensaje('solMsg', '', '');
  resp.push(Respuesta(500, { error: 'timeout' }));
  var p = y.c.listar(true);
  Check('L2 en fondo no dice "Cargando…"', false, /Cargando/.test(y.$('solMsg').innerHTML));
  var estado = await p.then(function () { return y.c.ultimoEstado; });
  Check('L3 falla en fondo (500): la lista sigue y el aviso es discreto', [antes, 'ini-cambio-msg aviso', true, 500],
    [y.$('solLista').innerHTML, y.$('solMsg').className, /se muestra la última lectura/.test(y.$('solMsg').innerHTML), estado]);
  resp.push(Promise.reject(new Error('red')));
  await y.c.listar(true);
  Check('L3 sin conexion en fondo: la lista sigue', [antes, true, null], [y.$('solLista').innerHTML, /sin conexión/.test(y.$('solMsg').innerHTML), y.c.ultimoEstado]);
  resp.push(Respuesta(403, { error: 'Solo un administrador (ADM)…' }));
  var est403 = await y.c.refrescarFondo();
  Check('L4 403 en fondo: el camino de siempre (el acceso cambio) y RefrescoAuto recibe 403', ['', true, 403],
    [y.$('solLista').innerHTML, /Solo un administrador/.test(y.$('solMsg').innerHTML), est403]);
  resp.push(Respuesta(500, { error: 'x' }));
  await y.c.listar();
  Check('L5 a mano (no fondo) la falla se ve como siempre', 'ini-cambio-msg error', y.$('solMsg').className);

  // Nuevas y Mis solicitudes: mismas reglas.
  var dn = Documento(), rn = [];
  var n = new caja.SolicitudesNuevas.RegistroSolicitudesNuevas(dn, function () { return rn.shift(); });
  n.fijarRol('ADM'); n.cablear(); n.vista = 'nuevas';
  rn.push(Respuesta(200, { solicitudes: [{ numero: 3, numero_texto: '#0000003', estado: 'ENVIADA' }], total: 1 }));
  await n.listar();
  var antesN = dn.getElementById('snLista').innerHTML;
  rn.push(Respuesta(503, {}));
  await n.listar(true);
  Check('L6 Nuevas: falla en fondo conserva lista y resumen', [antesN, true], [dn.getElementById('snLista').innerHTML, /última lectura/.test(dn.getElementById('snMsg').innerHTML)]);
  var lento = Diferida();
  rn.push(lento.promesa.then(function () { return Respuesta(200, { solicitudes: [], total: 0 }); }));
  var pv = n.listar(true);
  rn.push(Respuesta(200, { solicitudes: [{ numero: 9, numero_texto: '#0000009', estado: 'ENVIADA' }], total: 1 }));
  await n.listar();
  lento.resolver(); await pv;
  Check('L6 Nuevas: la vieja (vacia) no pisa a la nueva', true, /#0000009/.test(dn.getElementById('snLista').innerHTML));
  var dm = Documento(), rm = [];
  var m = new caja.SolicitudesNuevas.MisSolicitudes(dm, function () { return rm.shift(); });
  m.cablear();
  rm.push(Respuesta(200, { solicitudes: [{ numero: 4, numero_texto: '#0000004', estado: 'ENVIADA' }], total: 1 }));
  await m.listar();
  var antesM = dm.getElementById('msLista').innerHTML;
  rm.push(Promise.reject(new Error('red')));
  await m.listar(true);
  Check('L7 Mis solicitudes: sin conexion en fondo conserva la lista', [antesM, true], [dm.getElementById('msLista').innerHTML, /sin conexión/.test(dm.getElementById('msMsg').innerHTML)]);

  // ================= P) puedeRefrescar =================
  var z = Cola(function () { return Respuesta(200, { solicitudes: [] }); });
  Check('P1 cola ADM visible y quieta: se puede', true, z.c.puedeRefrescar());
  z.c.detalle = { id: 1 };
  Check('P2 con un detalle abierto: no', false, z.c.puedeRefrescar());
  z.c.detalle = null; z.c.ocupado = true;
  Check('P3 aplicando / rechazando: no', false, z.c.puedeRefrescar());
  z.c.ocupado = false;
  var panel = z.$('panel-solicitudes'), filtro = z.$('solFiltro'); filtro.tagName = 'SELECT'; panel.hijos.push(filtro);
  z.d.activeElement = filtro;
  Check('P4 alguien eligiendo en el filtro (select con foco en la pestaña): no', false, z.c.puedeRefrescar());
  var com = z.$('solComentario'); com.tagName = 'TEXTAREA'; panel.hijos.push(com); z.d.activeElement = com;
  Check('P4 alguien escribiendo un comentario: no', false, z.c.puedeRefrescar());
  var fuera = Elemento('fuera'); fuera.tagName = 'INPUT'; z.d.activeElement = fuera;
  Check('P4 un input fuera de la pestaña no estorba', true, z.c.puedeRefrescar());
  panel.hidden = true;
  Check('P5 pestaña Solicitudes oculta: no', false, z.c.puedeRefrescar());
  panel.hidden = false; z.$('solVistaCambio').hidden = true;
  Check('P5 vista "Cambios" oculta (se ve "Iniciativas"): la cola no', false, z.c.puedeRefrescar());
  z.c.fijarRol('MOD'); z.$('solVistaCambio').hidden = false;
  Check('P6 sin ADM: la cola no', false, z.c.puedeRefrescar());
  Check('P7 Nuevas en su vista: si; en "Cambios": no', [true, false], [n.puedeRefrescar(), (n.vista = 'cambio', n.puedeRefrescar())]);
  n.vista = 'nuevas'; n.detalle = { numero: 3 };
  Check('P7 Nuevas con detalle abierto: no', false, n.puedeRefrescar());
  dm.getElementById('msDetalle').hidden = true;   // como en el HTML: cerrado
  Check('P8 Mis solicitudes: si; con su detalle abierto: no', [true, false],
    [m.puedeRefrescar(), (dm.getElementById('msDetalle').hidden = false, m.puedeRefrescar())]);

  // ================= W) la pagina =================
  var html = leer('admin/iniciativas.html'), pag = leer('admin/iniciativas.js');
  Check('W1 iniciativas.html carga refresco-auto.js antes de iniciativas.js', true,
    html.indexOf('../assets/js/refresco-auto.js') > 0 && html.indexOf('../assets/js/refresco-auto.js') < html.indexOf('<script src="iniciativas.js">'));
  Check('W2 dos RefrescoAuto: las listas de Solicitudes (cola / nuevas / mias) y el registro de Iniciativas', [2, true, true, true],
    [(pag.match(/new window\.RefrescoAuto\(/g) || []).length, /\[this\.cola, this\.nuevas, this\.mias\]/.test(pag),
     /l\.refrescarFondo\(\)/.test(pag) && /l\.puedeRefrescar\(\)/.test(pag),
     /intervalo: window\.RefrescoAuto\.INTERVALO_DATOS/.test(pag) && /regAuto\.puedeRefrescar\(\)/.test(pag) && /regAuto\.refrescarFondo\(\)/.test(pag)]);
  // Experiencia, QA, Efectividad y Orquestacion se refrescan con el MISMO
  // temporizador del tablero: ninguno arma el suyo, publican refrescar() y
  // el router los conoce por refrescoDe(). Analisis y Observabilidad no.
  var MODS = ['experiencia/experiencia.js', 'qa/qa.js', 'efectividad/efectividad.js', 'orquestacion/orquestacion.js'];
  Check('W3 los cuatro modulos no arman temporizador propio', [],
    MODS.filter(function (f) { return /new (window\.)?RefrescoAuto\(/.test(leer(f)); }));
  Check('W3b los cuatro publican refrescar y su pagina suelta carga refresco-auto.js', [true, true, true, true],
    MODS.map(function (f) { return /refrescar[,:]/.test(leer(f)) && /refresco-auto\.js/.test(leer(f.replace(/\.js$/, '.html'))); }));
  var dash0 = leer('dashboard.js');
  Check('W3c el router los refresca (refrescoDe) y no a Analisis', [true, true, true, true, false],
    ['TableroExperienciaModulo', 'TableroQaModulo', 'TableroEfectividadModulo', 'TableroOrquestacionModulo', 'TableroAnalisisModulo']
      .map(function (g) { return dash0.indexOf("refrescoDe('" + g + "')") >= 0; }));
  var dash = leer('dashboard.js'), dashHtml = leer('dashboard.html');
  Check('W4 dashboard: UN RefrescoAuto con INTERVALO_DATOS; refresco-auto.js antes de dashboard.js', [1, true, true],
    [(dash.match(/new RefrescoAuto\(/g) || []).length, /intervalo: RefrescoAuto\.INTERVALO_DATOS/.test(dash),
     dashHtml.indexOf('assets/js/refresco-auto.js') > 0 && dashHtml.indexOf('assets/js/refresco-auto.js') < dashHtml.indexOf('<script src="dashboard.js">')]);
  Check('W5 Backlog y QARE sueltos cargan refresco-auto.js y publican refrescar', [true, true, true, true],
    [/refresco-auto\.js/.test(leer('backlog/backlog.html')), /refresco-auto\.js/.test(leer('qare/qare.html')),
     /return \{ init, refrescar,/.test(leer('backlog/backlog.js')), /refrescar: refrescar/.test(leer('qare/qare.js'))]);

  // ================= D) intervalo de datos y boton =================
  Check('D1 intervalo de datos por omision: 5 minutos', 300000, RA.INTERVALO_DATOS);
  var bot = Elemento('b'); bot.dataset = {}; bot.disabled = false; bot.textContent = 'Actualizar';
  var pedidosBoton = 0, difBoton = Diferida();
  RA.cablearBoton(bot, function () { pedidosBoton++; return difBoton.promesa; });
  RA.cablearBoton(bot, function () { pedidosBoton += 100; return Promise.resolve(); });
  bot.disparar('click'); await tics();
  bot.disparar('click'); bot.disparar('click'); await tics();
  Check('D2 boton: pide ya, una sola vez con clics seguidos; deshabilitado y "Actualizando…" mientras tanto',
    [1, true, 'Actualizando…'], [pedidosBoton, bot.disabled, bot.textContent]);
  difBoton.resolver(); await tics();
  Check('D3 al terminar vuelve a estar habilitado con su texto; cablear dos veces no duplica', [false, 'Actualizar', 1],
    [bot.disabled, bot.textContent, pedidosBoton]);
  var docDd = { querySelector: function (s) { return s === '.dd.abierto' ? {} : null; } };
  Check('D4 eligiendo: un desplegable abierto si; ninguno no', [true, false],
    [RA.eligiendo(docDd), RA.eligiendo({ querySelector: function () { return null; } })]);

  console.log(fallos === 0 ? 'TODO PASO' : fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
