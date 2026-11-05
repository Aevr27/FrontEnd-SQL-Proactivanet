// Prueba en node (sin navegador ni servidor) de la capa de pantalla de
// sql/41 y sql/42: cancelar y modificar (reemplazar) una solicitud propia
// PENDIENTE, en Iniciativas (admin/solicitudes-nuevas.js + Nueva solicitud de
// admin/iniciativas.js) y en Cambios (admin/solicitudes-cambio.js +
// "Solicitar cambios" de admin/registro-iniciativas.js).
//
//   C  Cambios: botones solo con puede_cancelar; CANCELADA y enlaces;
//      cancelar en dos pasos (motivo y confirmar) al endpoint de cancelar;
//      409 de la carrera con ADM; Modificar abre el formulario o lo dice.
//   N  Iniciativas: lo mismo, con el POST de cancelar a validar.ashx.
//   R  registro: la solicitud guardada -> la lista de cambios (todos los
//      tipos); el motivo de la correccion es obligatorio; el envio va a
//      accion=reemplazar con reemplaza_a y motivo_cancelacion.
//   P  pagina: Modificar abre Nueva solicitud con lo enviado y el aviso;
//      el envio lleva reemplaza_a / motivo_cancelacion; ADM sin cambios.
// Correr: node tools/tests/CancelarReemplazarSmoke.js
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

// ---------------------------------------------------------------------------
// DOM de mentira: solo lo que tocan globo-ayuda.js e iniciativas.js
// ---------------------------------------------------------------------------
function Elemento(id) {
  var oyentes = {};
  var clases = {};
  var atributos = {};
  return {
    id: id, textContent: '', hidden: false, innerHTML: '', value: '', disabled: false,
    className: '', style: {}, offsetWidth: 200, hijos: [],
    classList: {
      add: function (c) { clases[c] = true; },
      remove: function (c) { delete clases[c]; },
      toggle: function (c, v) { if (v) clases[c] = true; else delete clases[c]; },
      contains: function (c) { return !!clases[c]; }
    },
    setAttribute: function (k, v) { atributos[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(atributos, k) ? atributos[k] : null; },
    removeAttribute: function (k) { delete atributos[k]; },
    appendChild: function (h) { this.hijos.push(h); return h; },
    contains: function (otro) { return otro === this; },
    matches: function () { return false; },
    getBoundingClientRect: function () { return { left: 100, width: 80, bottom: 50 }; },
    addEventListener: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    disparar: function (tipo, evento) {
      var self = this;
      var e = evento || { target: self };
      (oyentes[tipo] || []).forEach(function (fn) { fn(e); });
    },
    // Valores de las <option>, sin la primera (placeholder value="").
    opciones: function () {
      var salida = [], re = /<option value="([^"]*)">/g, m;
      while ((m = re.exec(this.innerHTML))) if (m[1] !== '') salida.push(m[1]);
      return salida;
    }
  };
}

function Documento() {
  var els = {};
  var doc = Elemento('document');
  doc.readyState = 'complete';
  doc.getElementById = function (id) { return els[id] || (els[id] = Elemento(id)); };
  // Solo con selectoresAtributo (pruebas AV): '[data-x]' devuelve los
  // elementos con ese atributo, como lo recorre SesionAdmin.aplicar. Sin la
  // bandera, [] como siempre (el resto de las pruebas no cambia).
  doc.querySelectorAll = function (sel) {
    var m = doc.selectoresAtributo && /^\[([\w-]+)\]$/.exec(sel);
    if (!m) return [];
    return Object.keys(els).map(function (k) { return els[k]; })
      .filter(function (el) { return el.getAttribute(m[1]) !== null; });
  };
  doc.createElement = function () { return Elemento(''); };
  doc.body = Elemento('body');
  doc.documentElement = { clientWidth: 1200 };
  return doc;
}

// Las secciones que SesionAdmin destapa o no: hidden y data-solo-* tal como
// estan en el HTML (el documento falso no parsea el HTML).
var IDS_SESION = ['avSeccion', 'crSeccion', 'tab-administracion', 'btnCrearAdmin'];
function ComoEnElHtml(documento, html) {
  IDS_SESION.forEach(function (id) {
    var m = new RegExp('<[a-z]+\\b[^>]*\\bid="' + id + '"[^>]*>').exec(html);
    if (!m) throw new Error('falta #' + id + ' en admin/iniciativas.html');
    var el = documento.getElementById(id);
    el.hidden = /\shidden[\s>]/.test(m[0]);
    ['data-solo-adm', 'data-solo-registro'].forEach(function (a) {
      if (new RegExp('\\s' + a + '[\\s>=]').test(m[0])) el.setAttribute(a, '');
    });
  });
}

// SesionAdmin.aplicar de verdad, con admin_sesion respondiendo ADM.
function SesionAdm(ventana, documento) {
  return new ventana.SesionAdmin('../', function () {
    return Promise.resolve({ ok: true, json: function () { return { autorizado: true, rol: 'ADM', solicitante: true, registro: true }; } });
  }).aplicar(documento);
}

// Carga los scripts en una "ventana" nueva con su documento y su fetch.
function Pagina(pedir, antes) {
  var ventana = Elemento('window');
  var documento = Documento();
  (new Function('window', leer('assets/js/escape.js')))(ventana);
  (new Function('window', leer('assets/js/duracion.js')))(ventana);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(ventana, ventana.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(ventana, documento);
  (new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
  // Como en la pagina: antes de iniciativas.js (su VolumetriaCliente y
  // htmlVolumetria son los de la volumetria de Nueva solicitud).
  (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', leer('admin/iniciativa-admin.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.Duracion);
  (new Function('window', leer('assets/js/seleccion-kpi.js')))(ventana);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', 'fetch', leer('admin/registro-iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.Duracion, pedir);
  // Como en la pagina: sesion-admin.js y acuse-iniciativa.js antes de
  // iniciativas.js; las secciones de ADM con los atributos REALES del HTML.
  (new Function('window', leer('assets/js/sesion-admin.js')))(ventana);
  (new Function('window', 'Escape', 'fetch', leer('admin/acuse-iniciativa.js')))(ventana, ventana.Escape, pedir);
  ComoEnElHtml(documento, leer('admin/iniciativas.html'));
  // antes(ventana, documento): ultimo ajuste antes de iniciativas.js (p. ej.
  // readyState 'loading' para que iniciar() espere a DOMContentLoaded).
  if (typeof antes === 'function') antes(ventana, documento);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.GloboAyuda, pedir);
  // Nueva solicitud es de ADM y MOD y no abre sin rol (falla cerrado). Las
  // pruebas de siempre corren como MOD, el rol mas bajo que la usa; la parte
  // RS prueba ADM, sin rol y lo que MOD no puede abrir.
  var rol = arguments.length >= 3 ? arguments[2] : 'MOD';
  if (rol) ventana.IniciativasPagina.fijarRol(rol);
  return { ventana: ventana, doc: documento, sel: function (id) { return documento.getElementById(id); } };
}

function Respuesta(status, cuerpo) {
  return {
    ok: status >= 200 && status < 300, status: status,
    json: function () {
      return typeof cuerpo === 'string' ? Promise.reject(new SyntaxError('no json')) : Promise.resolve(cuerpo);
    }
  };
}

function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }
function Boton(attrs) {
  var el = Elemento('boton');
  Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
  el.closest = function (sel) {
    var m = /^\[([\w-]+)\]$/.exec(sel);
    return m && el.getAttribute(m[1]) !== null ? el : null;
  };
  return { target: el };
}
var FILAS_P = [
  { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' },
  { director: 'Dir A', po: 'PO 1', so: 'SO y', categoria: '/A/Cat 2' }
];
var JSON_P = { tipos: [{ prefijo: 'ADO', nombre: 'Adopcion' }, { prefijo: 'PRB', nombre: 'Problem' }], tipo_problem: 'PRB', rutas: FILAS_P, omitidas: 0 };
function Fuente(post) {
  return function (url, op) {
    if (op && op.method === 'POST') return Promise.resolve(post(url, op));
    if (url.indexOf('admin_iniciativas_capacidad.ashx') >= 0) return Promise.resolve(Respuesta(200, { categoria: '/A/Cat 1', disponible: 0.5, determinable: true }));
    if (url.indexOf('admin_iniciativas_volumetria.ashx') >= 0) return Promise.resolve(Respuesta(200, { slot: 0, dias: 30, rutas: [{ ruta: '/A/Cat 1', estado: 'ok', volumetria: 1000 }] }));
    if (url.indexOf('registro') >= 0) return new Promise(function () {});
    return Promise.resolve(Respuesta(200, JSON_P));
  };
}

var base = Pagina(function () { return new Promise(function () {}); });
// Como en la pagina, las dos colas de la pestaña Solicitudes.
(new Function('window', 'Escape', leer('admin/solicitudes-cambio.js')))(base.ventana, base.ventana.Escape);
(new Function('window', 'Escape', leer('admin/solicitudes-nuevas.js')))(base.ventana, base.ventana.Escape);
var C = base.ventana.SolicitudesCambioCola, N = base.ventana.SolicitudesNuevas, R = base.ventana.RegistroIniciativas;
var pruebas = [];

function SolC(o) {
  var d = { id: 41, folio: 'PRB 2026-000001', titulo: 'Uno', tipo: 'ESTADO', estado: 'PENDIENTE', estado_anterior: 'En Solución',
    estado_nuevo: 'En Monitoreo', campo_fecha: 'FechaSolucion', etapa: 'Solución', fecha_anterior: '2026-11-15', fecha_nueva: '2026-12-05',
    motivo: 'Pasa a monitoreo', solicitado_por: 'SORIANA\\juanperez', rol_solicitante: 'PSO', fecha_solicitud_utc: '2026-11-04T16:00:00Z',
    actual: { estado: 'En Solución' }, categorias_detalle: [], eventos: [], puede_cancelar: true, es_propia: true };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}
function SolN(o) {
  var d = { numero: 12, numero_texto: '#0000012', estado: 'ENVIADA', tipo: 'ADO', titulo: 'Titulo enviado', po: 'PO 1', so: 'SO x',
    categoria: '/A/Cat 1', descripcion: 'Desc', observaciones: 'Obs', pct: '12.5', volumetria: 1000, fecha_utc: '2026-11-04T16:00:00Z',
    solicitante_cuenta: 'SORIANA\\juanperez', eventos: [], puede_cancelar: true, es_propia: true, cancelacion_disponible: true };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}

// ---------------- C: Cambios ----------------
pruebas.push(function () {
  var mia = C.htmlDetalle(SolC(), null, null, true);
  Check('C1 Mis (lectura) con puede_cancelar: motivo, Cancelar, Modificar y su mensaje; sin nada de ADM', [true, true, true, true, false],
    [/id="mcMotivoCancelacion"/.test(mia), /data-cx-accion="cancelar"/.test(mia), /data-cx-accion="modificar"/.test(mia), /id="mcDetMsg"/.test(mia),
     /data-sol-accion="aplicar"/.test(mia)]);
  var sin = C.htmlDetalle(SolC({ puede_cancelar: false }), null, null, true);
  Check('C2 sin puede_cancelar (no es suya, ya no pendiente o sin sql/41): ningun boton', [false, false], [/data-cx-accion/.test(sin), /MotivoCancelacion/.test(sin)]);
  var canc = C.htmlDetalle(SolC({ estado: 'CANCELADA', puede_cancelar: false, cancelado_por: 'SORIANA\\juanperez', fecha_cancelacion_utc: '2026-11-05T10:00:00Z',
    motivo_cancelacion: '<b>ya no</b>', reemplazada_por: 45 }), null, null, true);
  Check('C3 CANCELADA: quien / motivo (escapado), enlace a la que la reemplazo (Mis), sin "por null"', [true, true, true, false, true],
    [/Cancelada<\/strong> por quien la envió \(SORIANA\\juanperez\)/.test(canc), /&lt;b&gt;ya no&lt;\/b&gt;/.test(canc),
     /data-mc-ir="45"[^>]*>#45</.test(canc), /por null|Cancelada por  el/.test(canc), /Reemplazada por la solicitud/.test(canc)]);
  var adm = C.htmlDetalle(SolC({ reemplaza_a: 40 }), {}, {});
  Check('C4 ADM, una suya PENDIENTE: aplicar / rechazar siguen y ademas Cancelar / Modificar; enlace data-sol-ir', [true, true, true, true],
    [/data-sol-accion="aplicar"/.test(adm), /data-sol-accion="rechazar"/.test(adm), /id="solMotivoCancelacion"/.test(adm), /data-sol-ir="40"/.test(adm)]);
  var admCanc = C.htmlDetalle(SolC({ estado: 'CANCELADA', puede_cancelar: false }), {}, {});
  Check('C5 ADM, CANCELADA: sin aplicar ni rechazar (solo Cerrar)', [false, false, true],
    [/data-sol-accion="aplicar"/.test(admCanc), /data-sol-accion="rechazar"/.test(admCanc), /data-sol-accion="cerrar"/.test(admCanc)]);
  var lista = C.htmlListaMias([SolC({ estado: 'CANCELADA', reemplazada_por: 45 }), SolC({ id: 45, reemplaza_a: 41 })], '');
  Check('C6 lista: Cancelada, "reemplazada por #45" y "corrige a #41"', [true, true, true],
    [/<td>Cancelada<span class="ini-sub">reemplazada por #45/.test(lista), /corrige a #41/.test(lista), C.ESTADOS.CANCELADA === 'Cancelada']);

  // Flujo de MisCambios.
  var doc = Documento(), pedidas = [], cuerpos = [];
  var resps = [Respuesta(200, SolC()), Respuesta(200, { valida: true, cancelada: true, id_solicitud: 41 }),
               Respuesta(200, { solicitudes: [] }), Respuesta(200, SolC({ estado: 'CANCELADA', puede_cancelar: false }))];
  var v = new C.MisCambios(doc, function (url, op) { pedidas.push([url, op && op.method]); if (op && op.body) cuerpos.push(op.body); return resps.shift(); });
  v.cablear();
  return v.verDetalle(41).then(function () {
    doc.getElementById('mcDetalle').disparar('click', Boton({ 'data-cx-accion': 'cancelar' }));
    Check('C7 Cancelar sin motivo: lo pide, nada sale al servidor', [true, 1], [/Explica por qué cancelas/.test(doc.getElementById('mcDetMsg').innerHTML), pedidas.length]);
    doc.getElementById('mcMotivoCancelacion').value = '  Ya no aplica  ';
    doc.getElementById('mcDetalle').disparar('click', Boton({ 'data-cx-accion': 'cancelar' }));
    Check('C8 con motivo: primero pregunta (Sí, cancelarla), todavía nada sale', [true, 1],
      [/data-cx-accion="confirmar-cancelacion"/.test(doc.getElementById('mcDetMsg').innerHTML), pedidas.length]);
    doc.getElementById('mcDetalle').disparar('click', Boton({ 'data-cx-accion': 'confirmar-cancelacion' }));
    return esperar().then(esperar).then(esperar);
  }).then(function () {
    var post = pedidas[1];
    Check('C9 confirmar: POST a accion=cancelar con id y el motivo recortado (nunca la cuenta)', ['../handlers/admin_iniciativas_solicitudes.ashx?accion=cancelar', 'POST', '41', 'Ya no aplica', null],
      [post[0], post[1], cuerpos[0].get('id'), cuerpos[0].get('motivo'), cuerpos[0].get('usuario')]);
    Check('C10 despues relee lista y detalle (la verdad del servidor) y dice cancelada', [4, true, true],
      [pedidas.length, /cancelada\./.test(doc.getElementById('mcDetMsg').innerHTML), /Cancelada/.test(doc.getElementById('mcDetalle').innerHTML)]);
  }).then(function () {
    // Carrera: ADM la aplico antes.
    var doc2 = Documento(), r2 = [Respuesta(200, SolC()), Respuesta(409, { error: 'Un administrador ya aplicó esta solicitud: no se cambió nada.', tipo: 'SolicitudNoPendiente', cancelada: false, estado_actual: 'APLICADA' }),
      Respuesta(200, { solicitudes: [] }), Respuesta(200, SolC({ estado: 'APLICADA', puede_cancelar: false }))];
    var v2 = new C.MisCambios(doc2, function () { return r2.shift(); });
    v2.cablear();
    return v2.verDetalle(41).then(function () {
      doc2.getElementById('mcMotivoCancelacion').value = 'm';
      doc2.getElementById('mcDetalle').disparar('click', Boton({ 'data-cx-accion': 'confirmar-cancelacion' }));
      return esperar().then(esperar).then(esperar);
    }).then(function () {
      Check('C11 409 (ADM gano la carrera): "No se canceló" con el mensaje del servidor, en rojo', [true, true, true],
        [/No se canceló/.test(doc2.getElementById('mcDetMsg').innerHTML), /ya aplicó/.test(doc2.getElementById('mcDetMsg').innerHTML),
         /error/.test(doc2.getElementById('mcDetMsg').className)]);
    });
  }).then(function () {
    var doc3 = Documento(), r3 = [Respuesta(200, SolC())], abierta = null;
    var v3 = new C.MisCambios(doc3, function () { return r3.shift(); });
    v3.cablear();
    v3.alModificar = function (d) { abierta = d.id; return false; };
    return v3.verDetalle(41).then(function () {
      doc3.getElementById('mcDetalle').disparar('click', Boton({ 'data-cx-accion': 'modificar' }));
      Check('C12 Modificar: pasa la solicitud a la pagina; si no se pudo abrir, lo dice', [41, true],
        [abierta, /No se pudo abrir la iniciativa/.test(doc3.getElementById('mcDetMsg').innerHTML)]);
      doc3.getElementById('mcDetalle').disparar('click', Boton({ 'data-mc-ir': '45' }));
      Check('C13 el enlace a la relacionada abre su detalle (del endpoint propio)', true, r3.length === 0);
    });
  });
});

// ---------------- N: Iniciativas ----------------
pruebas.push(function () {
  var mia = N.htmlDetalle(SolN(), false, 'ms');
  Check('N1 Mis con puede_cancelar: motivo, Cancelar, Modificar, msDetMsg; sin aprobar / rechazar', [true, true, true, true, false],
    [/id="msMotivoCancelacion"/.test(mia), /data-sx-accion="cancelar"/.test(mia), /data-sx-accion="modificar"/.test(mia), /id="msDetMsg"/.test(mia),
     /data-sn-accion="aprobar"/.test(mia)]);
  Check('N2 htmlDetalle con dos argumentos sigue con snDetMsg (ADM)', true, /id="snDetMsg"/.test(N.htmlDetalle(SolN({ puede_cancelar: false }), true)));
  var canc = N.htmlDetalle(SolN({ estado: 'CANCELADA', puede_cancelar: false, cancelado_por: 'SORIANA\\juanperez', fecha_cancelacion_utc: '2026-11-05T10:00:00Z',
    motivo_cancelacion: 'No va', reemplazada_por: { numero: 13, numero_texto: '#0000013' } }), true);
  Check('N3 CANCELADA (ADM): sin aprobar ni rechazar; quien y motivo; enlace a la nueva', [false, false, true, true],
    [/data-sn-accion="aprobar"/.test(canc), /data-sn-accion="rechazar"/.test(canc), /Cancelada<\/strong>[\s\S]*No va/.test(canc), /data-sn-ir="13"[^>]*>#0000013</.test(canc)]);
  var lista = N.htmlLista([SolN({ estado: 'CANCELADA', reemplazada_por: { numero: 13, numero_texto: '#0000013' } }), SolN({ numero: 13, numero_texto: '#0000013', reemplaza_a: { numero: 12, numero_texto: '#0000012' } })]);
  Check('N4 lista: Cancelada con "reemplazada por" y la nueva "corrige a"', [true, true, true],
    [/Cancelada<span class="ini-sub">reemplazada por #0000013/.test(lista), /corrige a #0000012/.test(lista), N.ESTADOS.CANCELADA === 'Cancelada']);

  var doc = Documento(), pedidas = [], cuerpos = [];
  var resps = [Respuesta(200, SolN()), Respuesta(200, { cancelada: true, numero: 12, numero_texto: '#0000012' }),
               Respuesta(200, { solicitudes: [] }), Respuesta(200, SolN({ estado: 'CANCELADA', puede_cancelar: false }))];
  var v = new N.MisSolicitudes(doc, function (url, op) { pedidas.push([url, op && op.method]); if (op && op.body) cuerpos.push(op.body); return resps.shift(); });
  v.cablear();
  return v.verDetalle(12).then(function () {
    doc.getElementById('msMotivoCancelacion').value = ' No la necesito ';
    doc.getElementById('msDetalle').disparar('click', Boton({ 'data-sx-accion': 'cancelar' }));
    Check('N5 primero confirma, nada sale', [true, 1], [/confirmar-cancelacion/.test(doc.getElementById('msDetMsg').innerHTML), pedidas.length]);
    doc.getElementById('msDetalle').disparar('click', Boton({ 'data-sx-accion': 'confirmar-cancelacion' }));
    return esperar().then(esperar).then(esperar);
  }).then(function () {
    Check('N6 POST a validar.ashx con accion=cancelar, numero y motivo recortado', ['../handlers/admin_iniciativas_validar.ashx', 'POST', 'cancelar', '12', 'No la necesito'],
      [pedidas[1][0], pedidas[1][1], cuerpos[0].get('accion'), cuerpos[0].get('numero'), cuerpos[0].get('motivo')]);
    Check('N7 relee y dice cancelada', [4, true], [pedidas.length, /cancelada\./.test(doc.getElementById('msDetMsg').innerHTML)]);
  });
});

// ---------------- R: registro (Solicitar cambios como reemplazo) ----------------
pruebas.push(function () {
  var it = R.itemsDeSolicitud;
  Check('R1 ESTADO con fecha: Estado + la fecha de su etapa', [['estado', 'En Monitoreo'], ['f_solucion', '2026-12-05']],
    it(SolC()).map(function (x) { return [x.campo, x.propuesto]; }));
  Check('R2 FECHA sola', [['f_cierre', '2027-01-10']], it(SolC({ tipo: 'FECHA', estado_nuevo: null, campo_fecha: 'FechaCierre', fecha_nueva: '2027-01-10' })).map(function (x) { return [x.campo, x.propuesto]; }));
  var cats = it(SolC({ tipo: 'CATEGORIAS', estado_nuevo: null, campo_fecha: null, categorias_detalle: [
    { categoria: '/A/Cat 1', accion: 'MODIFICAR', pct_nuevo: '20' }, { categoria: '/A/Cat 2', accion: 'AGREGAR', pct_nuevo: '5' }] }));
  Check('R3 CATEGORIAS: ligadas a pcts, por agregar a nuevas', [1, 'pct', { '/A/Cat 1': '20' }, [{ categoria: '/A/Cat 2', valor: '5' }]],
    [cats.length, cats[0].campo, cats[0].pcts, cats[0].nuevas]);
  // HISTORICO (antes del % entero, 2026-11-05): corregir una solicitud
  // guardada con 12.5% la muestra tal cual, pero no se reenvia con
  // decimales: el aviso pide el % entero; corregida a 12, pasa.
  var hIni = { folio: 'PRB 2026-000001', estado: 'En Solución', categorias: [{ categoria: '/A/Cat 1', pct_dism: 0.2 }] };
  var hl = new R.ListaSolicitudCambio(hIni, {});
  hl.cargarSolicitud(SolC({ tipo: 'CATEGORIAS', estado_nuevo: null, campo_fecha: null,
    categorias_detalle: [{ categoria: '/A/Cat 1', accion: 'PCT', pct_nuevo: '12.5' }] }));
  hl.motivoCancelacion = 'Corrijo el %';
  function pctMal(lista) { return lista.validarEnvio().some(function (e) { return /porcentaje entero entre 0 y 100, sin decimales/.test(e.mensaje); }); }
  Check('R3b historico 12.5%: se ve tal cual en la lista (20% → 12.5%) y bloquea el reenvio con el aviso de % entero', ['12.5', true, true],
    [hl.items[0].pcts['/A/Cat 1'], /20% → 12\.5%/.test(hl.texto(hl.items[0]).linea), pctMal(hl)]);
  hl.items[0].pcts['/A/Cat 1'] = '12';
  Check('R3b ... corregido a 12: sin ese error y viaja 12', [false, ['12']],
    [pctMal(hl), (hl.pares() || []).filter(function (p) { return p[0] === 'pct_valor'; }).map(function (p) { return p[1]; })]);
  var datos = it(SolC({ tipo: 'DATOS', estado_nuevo: null, campo_fecha: null, cambia_titulo: true, titulo_nuevo: 'T2', cambia_po: false, cambia_so: true, so_nuevo: 'SO y' }));
  Check('R4 DATOS: solo los pedidos', [{ titulo: 'T2', po: null, so: 'SO y' }], datos.map(function (x) { return x.datos; }));
  var otros = SolC({ tipo: 'OTROS', estado_nuevo: null, campo_fecha: null, motivo: 'Categoria equivocada\n\nMotivo: lo vio el PO' });
  Check('R5 OTROS: explicacion y motivo separados como los junto el envio', ['Categoria equivocada', 'lo vio el PO'],
    [it(otros)[0].explicacion, R.motivoDeSolicitud(otros)]);
  var varios = it(SolC({ tipo: 'VARIOS', campo_fecha: null, estado_nuevo: 'Cerrado', fechas_varias: [{ campo: 'FechaAnalisis', nueva: '2026-12-01' }, { campo: 'FechaCierre', nueva: '2027-02-01' }],
    categorias_detalle: [{ categoria: '/A/Cat 1', accion: 'MODIFICAR', pct_nuevo: '30' }], cambia_titulo: true, titulo_nuevo: 'Nuevo' }));
  Check('R6 VARIOS: Estado, cada fecha, categorias y datos', ['estado', 'f_analisis', 'f_cierre', 'pct', 'datos'], varios.map(function (x) { return x.campo; }));
  var ini = { folio: 'PRB 2026-000001', estado: 'En Solución', categorias: [] };
  var l = new R.ListaSolicitudCambio(ini, {});
  l.cargarSolicitud(SolC());
  Check('R7 cargarSolicitud: los cambios, el motivo y la original; sin motivo de correccion no se envia', [2, 'Pasa a monitoreo', 41, true],
    [l.items.length, l.motivo, l.reemplaza.id, l.validarEnvio().some(function (e) { return e.campo === 'motivo_cancelacion'; })]);
  l.motivoCancelacion = 'Me equivoque de fecha';
  Check('R8 con motivo de correccion: ese error ya no sale; los pares son los de un envio (UNA solicitud, llave nueva)', [false, true],
    [l.validarEnvio().some(function (e) { return e.campo === 'motivo_cancelacion'; }), (l.pares() || []).some(function (p) { return p[0] === 'llave'; })]);
  l.motivoCancelacion = new Array(2002).join('x');
  Check('R9 motivo de correccion de 2001: no se envia', true, l.validarEnvio().some(function (e) { return e.campo === 'motivo_cancelacion'; }));
  var js = leer('admin/registro-iniciativas.js');
  Check('R10 el envio de un reemplazo va a accion=reemplazar con reemplaza_a y motivo_cancelacion', [true, true, true],
    [/'\?accion=' \+ \(reemplaza \? 'reemplazar' : 'enviar'\)/.test(js), /datos\.append\('reemplaza_a', String\(reemplaza\.id\)\)/.test(js),
     /datos\.append\('motivo_cancelacion'/.test(js)]);
});

// ---------------- P: pagina (Nueva solicitud como reemplazo) ----------------
pruebas.push(function () {
  var posts = [];
  var respuesta = function () { return Respuesta(200, { valida: true, errores: [], guardada: true, nuevo: true, numero_solicitud: '#0000013', reemplaza_a: '#0000012' }); };
  var p = Pagina(Fuente(function (url, op) { posts.push([url, op.body]); return respuesta(); }));
  var P = p.ventana.IniciativasPagina;
  return P.cargar(Fuente(function (url, op) { posts.push([url, op.body]); return respuesta(); })).then(function () {
    Check('P0 aviso de reemplazo en el HTML (oculto) y el filtro Canceladas en las cuatro listas', [true, 4],
      [/<div class="ini-cambio-msg aviso" id="iniReemplazo" hidden>/.test(leer('admin/iniciativas.html')),
       (leer('admin/iniciativas.html').match(/<option value="CANCELADA">Canceladas<\/option>/g) || []).length]);
    var ok = P.modificarSolicitud(SolN());
    var s = P.solicitud;
    Check('P1 Modificar abre Nueva solicitud con lo enviado (tipo, cascada, textos, %) y el aviso de que corrige a #0000012',
      [true, 'nueva', 'ADO', ['PO 1', 'SO x', '/A/Cat 1'], 'Titulo enviado', 'Desc', 'Obs', '12.5', false, true],
      [ok, P.vista, s.tipo, s.cascada.seleccion.slice(0, 3), s.valores.titulo, s.valores.analisis, s.valores.observaciones, s.valores.pct,
       p.sel('iniReemplazo').hidden, /#0000012/.test(p.sel('iniReemplazoTexto').innerHTML)]);
    Check('P2 sin motivo de correccion: falta, y no se envia', true, s.erroresCliente().some(function (e) { return e.campo === 'motivo_cancelacion'; }));
    // % entero (2026-11-05): la solicitud de antes traia 12.5; se muestra
    // tal cual (P1), pero no se reenvia con decimales: hay que corregirlo.
    Check('P2b % historico con decimales: se ve tal cual y bloquea el envio con el aviso de % entero',
      ['12.5', 'Escribe un porcentaje entero entre 0 y 100, sin decimales.', true],
      [s.valores.pct, s.error('pct'), s.erroresCliente().some(function (e) { return e.campo === 'pct'; })]);
    s.capturar('pct', '12');
    Check('P2c corregido a 12: sin error de %', ['', false], [s.error('pct'), s.erroresCliente().some(function (e) { return e.campo === 'pct'; })]);
    p.sel('iniMotivoCancelacion').value = 'Me equivoque de titulo';
    p.sel('iniMotivoCancelacion').disparar('input', { target: p.sel('iniMotivoCancelacion') });
    var campos = s.camposEnvio();
    Check('P3 el envio lleva reemplaza_a y motivo_cancelacion (y un token nuevo, distinto del original)', ['12', 'Me equivoque de titulo', true],
      [campos.reemplaza_a, campos.motivo_cancelacion, typeof campos.token === 'string' && campos.token.length > 0]);
    return esperar().then(esperar).then(esperar).then(function () { return P.validar(); });
  }).then(function () {
    var cuerpo = posts.length ? posts[posts.length - 1][1] : null;
    Check('P4 un POST a validar con reemplaza_a / motivo_cancelacion y el % entero corregido', ['../handlers/admin_iniciativas_validar.ashx', '12', 'Me equivoque de titulo', '12'],
      [posts.length ? posts[posts.length - 1][0] : null, cuerpo && cuerpo.get('reemplaza_a'), cuerpo && cuerpo.get('motivo_cancelacion'), cuerpo && cuerpo.get('pct')]);
    Check('P5 exito: numero nuevo, a cual corrige; el borrador se limpia (sin reemplazo) y el aviso se oculta',
      [true, true, null, true],
      [/#0000013/.test(p.sel('iniResultado').innerHTML), /Corrige a la solicitud #0000012, que quedó cancelada/.test(p.sel('iniResultado').innerHTML),
       P.solicitud.reemplazo, p.sel('iniReemplazo').hidden]);
    var s2 = new (p.ventana.Iniciativas.SolicitudNueva)(P.solicitud.catalogo);
    var faltan = s2.prellenar(SolN({ po: 'PO que ya no existe' }));
    Check('P6 lo que ya no esta en el catalogo no se elige y se avisa (hay que volver a elegirlo)', [['po', 'so', 'categoria'], ''],
      [faltan, s2.cascada.seleccion[0] || '']);
    Check('P7 una solicitud nueva normal no manda reemplaza_a', [false, false],
      ['reemplaza_a' in P.solicitud.camposEnvio(), 'motivo_cancelacion' in P.solicitud.camposEnvio()]);
  });
});

pruebas.reduce(function (cadena, prueba) { return cadena.then(prueba); }, Promise.resolve())
  .then(function () {
    console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
    process.exit(fallos ? 1 : 0);
  }, function (err) {
    console.log('ERROR ' + (err && err.stack || err));
    process.exit(1);
  });
