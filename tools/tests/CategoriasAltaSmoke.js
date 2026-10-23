/* =========================================================================
   tools/tests/CategoriasAltaSmoke.js

   Prueba en node de admin/categorias-alta.js, sin navegador ni servidor ni
   red. El alta de categorias YA NO tiene entrada en admin/iniciativas.html
   (las categorias se crean en el sitio de Proactivanet); el modulo sigue en
   el repo, sin uso, y aqui se prueba suelto.

   Casos:
     F) FormularioAlta: errores locales, ruta resultante, lo que viaja.
     R) RespuestaAlta: estados; un 501 que dijera enviada/creada no se acepta.
     V) VistaAlta: padres cargados una vez; error de carga sin bloquear;
        errores locales no se envian; 501 = aviso + cuerpo + bloqueos, nunca
        exito; 422 / 403 / 503 / red.
     U) El modulo solo habla con admin_categorias_alta.ashx (nunca con
        Proactivanet).
     H) La pagina ya no tiene la seccion, el boton ni el <script>.
     S) Con la pagina real: abrir Administracion (ADM) no pide nada al
        handler de alta, aunque el modulo este cargado.

   Correr: node tools/tests/CategoriasAltaSmoke.js
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
  var oyentes = {}, clases = {}, atributos = {};
  return {
    id: id, textContent: '', hidden: false, innerHTML: '', value: '', checked: false, disabled: false, className: '', style: {},
    hijos: [], offsetWidth: 200,
    classList: {
      add: function (c) { clases[c] = true; }, remove: function () { for (var i = 0; i < arguments.length; i++) delete clases[arguments[i]]; },
      toggle: function (c, v) { if (v) clases[c] = true; else delete clases[c]; }, contains: function (c) { return !!clases[c]; }
    },
    setAttribute: function (k, v) { atributos[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(atributos, k) ? atributos[k] : null; },
    closest: function () { return this; }, focus: function () {}, matches: function () { return false; },
    appendChild: function (h) { this.hijos.push(h); return h; }, contains: function (o) { return o === this; },
    getBoundingClientRect: function () { return { left: 100, width: 80, bottom: 50 }; },
    addEventListener: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    disparar: function (tipo, evento) { var self = this; (oyentes[tipo] || []).forEach(function (fn) { fn(evento || { target: self }); }); }
  };
}
function Documento() {
  var els = {};
  var doc = Elemento('document');
  doc.readyState = 'complete';
  doc.getElementById = function (id) { return els[id] || (els[id] = Elemento(id)); };
  doc.querySelectorAll = function () { return []; };
  doc.createElement = function () { return Elemento(''); };
  doc.body = Elemento('body');
  doc.documentElement = Elemento('html');
  return doc;
}
function Respuesta(status, cuerpo) {
  return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(cuerpo); } };
}
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

var ventana = {};
(new Function('window', leer('assets/js/escape.js')))(ventana);
(new Function('window', leer('assets/js/duracion.js')))(ventana);
(new Function('window', 'Escape', leer('admin/categorias-alta.js')))(ventana, ventana.Escape);
var CA = ventana.CategoriasAlta;

var NO_HABILITADA = { valida: true, enviada: false, creada: false, integracion: 'no_habilitada', tipo: 'IntegracionNoHabilitada',
  errores: [], advertencias: ['adv X'], ruta_resultante: '/Sistemas/Nueva', integracion_motivo: 'Integración no habilitada: no se envió nada.',
  bloqueos: ['bloqueo 1', 'bloqueo 2'],
  envio: { metodo: 'POST', ruta: '/api/Categories', cuerpo: { Name: 'Nueva', PadCategories_id: null, PadCategories_ruta: '/Sistemas' } } };

// ---- F ----
var f = new CA.FormularioAlta();
Check('F1 sin nombre', ['nombre'], f.errores().map(function (e) { return e.campo; }));
f.capturar('nombre', 'A/B'); f.capturar('orden', '1.5');
Check('F2 nombre con / y orden no entero', ['nombre', 'orden'], f.errores().map(function (e) { return e.campo; }));
f.capturar('nombre', ' Nueva '); f.capturar('orden', '3'); f.capturar('padre', '/Sistemas/'); f.capturar('problemas', true);
Check('F3 valido y ruta normalizada', [[], '/Sistemas/Nueva'], [f.errores(), f.ruta()]);
Check('F4 lo que viaja (solo las casillas marcadas)', [['padre', '/Sistemas/'], ['nombre', ' Nueva '], ['descripcion', ''], ['orden', '3'], ['problemas', '1']], f.paraEnviar());
var raizF = new CA.FormularioAlta(); raizF.capturar('nombre', 'C1 nuevo');
Check('F5 sin padre: ruta de C1', '/C1 nuevo', raizF.ruta());

// ---- R ----
var R = CA.RespuestaAlta;
Check('R1 estados', ['no_habilitada', 'invalida', 'denegado', 'no_disponible', 'error', 'error'], [
  R.desde(501, NO_HABILITADA).estado, R.desde(422, { valida: false, errores: [] }).estado, R.desde(403, {}).estado,
  R.desde(503, {}).estado, R.desde(500, {}).estado, R.desde(0, null).estado]);
Check('R2 un 501 que dijera creada o enviada no se acepta', ['error', 'error', 'error'], [
  R.desde(501, Object.assign({}, NO_HABILITADA, { creada: true })).estado,
  R.desde(501, Object.assign({}, NO_HABILITADA, { enviada: true })).estado,
  R.desde(200, Object.assign({}, NO_HABILITADA)).estado]);
Check('R3 nunca creada', true, [501, 422, 403, 503, 200, 0].every(function (e) { return R.desde(e, NO_HABILITADA).creada === false; }));

// ---- V ----
function Vista(respuestas) {
  var doc = Documento(), pedidos = [];
  var pedir = function (url, op) {
    var campos = [];
    if (op && op.body && op.body.forEach) op.body.forEach(function (v, k) { campos.push([k, v]); });
    pedidos.push({ url: url, metodo: (op && op.method) || 'GET', campos: campos });
    var r = respuestas.shift();
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  return { v: new CA.VistaAlta(doc, pedir), doc: doc, pedidos: pedidos, $: function (id) { return doc.getElementById(id); } };
}
function escribir(t, id, valor) { var el = t.$(id); el.value = valor; el.disparar('input', { target: el }); }
function marcar(t, id) { var el = t.$(id); el.checked = true; el.disparar('change', { target: el }); }

var pruebas = [];
pruebas.push(function () {
  var t = Vista([Respuesta(200, { rutas: ['/Sistemas', '/Sistemas/Correo'] }), Respuesta(501, NO_HABILITADA),
                 Respuesta(422, { valida: false, tipo: 'ValidacionFallida', errores: [{ campo: 'padre', mensaje: 'La categoría padre está dada de baja.' }] }),
                 Respuesta(403, { error: 'Solo ADM', tipo: 'RolInsuficiente' }), Respuesta(503, { error: 'error 53', tipo: 'ValidacionNoDisponible' }),
                 new Error('red')]);
  return t.v.abrir().then(function () {
    Check('V1 padres en el datalist', 2, (t.$('caPadres').innerHTML.match(/<option /g) || []).length);
    return t.v.abrir();
  }).then(function () {
    Check('V2 abrir otra vez no repite el GET', 1, t.pedidos.length);
    return t.v.validar();
  }).then(function (r) {
    Check('V3 sin nombre: error local, nada se envia', [null, 1, true], [r, t.pedidos.length, t.$('caResultado').classList.contains('mal')]);
    escribir(t, 'ca-padre', '/Sistemas'); escribir(t, 'ca-nombre', 'Nueva'); marcar(t, 'ca-problemas');
    Check('V4 ruta resultante en vivo', '/Sistemas/Nueva', t.$('caRuta').textContent);
    return t.v.validar();
  }).then(function (r) {
    var caja = t.$('caResultado'), envio = t.pedidos[1];
    Check('V5 POST al handler con el formulario', ['POST', CA.URL_ALTA, 'Nueva', '1'],
      [envio.metodo, envio.url, envio.campos.filter(function (c) { return c[0] === 'nombre'; })[0][1],
       envio.campos.filter(function (c) { return c[0] === 'problemas'; })[0][1]]);
    Check('V6 501: aviso (no ok), "No se creó", cuerpo y bloqueos visibles', ['no_habilitada', true, false, true, true, true, true],
      [r.estado, caja.classList.contains('aviso'), caja.classList.contains('ok'), /No se creó/.test(caja.innerHTML),
       /POST \/api\/Categories/.test(caja.innerHTML), /&quot;PadCategories_id&quot;: null/.test(caja.innerHTML), /bloqueo 2/.test(caja.innerHTML)]);
    Check('V7 nunca dice creada con exito', false, /creada con éxito|Categoría creada/.test(caja.innerHTML));
    Check('V7b 501: el titulo empieza por "Solo validación" y dice que no se envió', [true, true],
      [/<strong class="ini-prototipo-marca">Solo validación:/.test(caja.innerHTML), /NO se envió a Proactivanet/.test(caja.innerHTML)]);
    return t.v.validar();
  }).then(function (r) {
    Check('V8 422: errores del servidor', ['invalida', true, true], [r.estado, /dada de baja/.test(t.$('caResultado').innerHTML), t.$('caResultado').classList.contains('mal')]);
    Check('V8b 422: "no se envió nada", sin "Solo validación"', [true, false],
      [/no se envió nada/.test(t.$('caResultado').innerHTML), /Solo validación/.test(t.$('caResultado').innerHTML)]);
    return t.v.validar();
  }).then(function (r) {
    Check('V9 403', ['denegado', true], [r.estado, /Sin permiso/.test(t.$('caResultado').innerHTML)]);
    Check('V9b 403: no se validó ni envió, clase mal', [true, true],
      [/No se validó ni se envió nada/.test(t.$('caResultado').innerHTML), t.$('caResultado').classList.contains('mal')]);
    return t.v.validar();
  }).then(function (r) {
    Check('V10 503: no dice validada', ['no_disponible', false], [r.estado, /Validada/.test(t.$('caResultado').innerHTML)]);
    return t.v.validar();
  }).then(function (r) {
    Check('V11 red caida', ['error', true, false], [r.estado, /No se envió nada/.test(t.$('caResultado').innerHTML), t.$('caValidar').disabled]);
    Check('V11b red caida: dice que no hubo contacto con el servidor', true, /No se pudo contactar al servidor/.test(t.$('caResultado').innerHTML));
  });
});
// V14-V16) Respuestas malformadas o sin lista de errores.
pruebas.push(function () {
  var t = Vista([Respuesta(200, { rutas: ['/A'] }),
                 Respuesta(422, { valida: false, tipo: 'ValidacionFallida', error: 'Padre no válido.', errores: [] }),
                 Respuesta(501, { valida: true, enviada: false, creada: false, error: 'Not Implemented' }),
                 Respuesta(200, Object.assign({}, NO_HABILITADA, { creada: true }))]);
  var caja = function () { return t.$('caResultado'); };
  return t.v.abrir().then(function () {
    escribir(t, 'ca-nombre', 'Nueva');
    return t.v.validar();
  }).then(function (r) {
    Check('V14 422 sin lista de errores: muestra el mensaje del servidor', ['invalida', true], [r.estado, /Padre no válido\./.test(caja().innerHTML)]);
    return t.v.validar();
  }).then(function (r) {
    Check('V15 501 sin tipo IntegracionNoHabilitada: error, nunca "Solo validación", clase mal', ['error', false, true],
      [r.estado, /Solo validación/.test(caja().innerHTML), caja().classList.contains('mal')]);
    return t.v.validar();
  }).then(function (r) {
    Check('V16 200 que dijera creada: error, nunca ok ni exito', ['error', false, false, false],
      [r.estado, r.creada, caja().classList.contains('ok'), /creada con éxito|Categoría creada/.test(caja().innerHTML)]);
  });
});
// H) La pagina ya no ofrece el alta de categorias.
pruebas.push(function () {
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  Check('H1 sin seccion, boton ni campos del alta', [false, false, false, false],
    [/id="caSeccion"/.test(html), /id="caValidar"/.test(html), /id="ca-nombre"/.test(html), /Alta de categor/.test(html)]);
  Check('H2 sin <script src="categorias-alta.js">', false, /<script src="categorias-alta\.js">/.test(html));
  Check('H3 Administracion ya no dice "y categorías"', false, /Gestión directa de iniciativas y categorías/.test(html));
  var js = leer('admin/iniciativas.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  Check('H4 iniciativas.js no arranca VistaAlta', false, /CategoriasAlta|altaCategoria/.test(js));
});
pruebas.push(function () {
  var t = Vista([Respuesta(500, { error: 'El servidor de SQL rechazo la consulta (error 53).' }), Respuesta(200, { rutas: ['/X'] })]);
  return t.v.abrir().then(function () {
    Check('V12 error al cargar padres: se dice y se puede escribir la ruta', true, /error 53/.test(t.$('caRutasEstado').textContent) && /escribir la ruta/.test(t.$('caRutasEstado').textContent));
    return t.v.abrir();
  }).then(function () {
    Check('V13 reabrir reintenta la carga', [2, 1], [t.pedidos.length, (t.$('caPadres').innerHTML.match(/<option /g) || []).length]);
  });
});

// ---- U ----
pruebas.push(function () {
  var src = leer('admin/categorias-alta.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  Check('U1 una sola URL: el handler local', ["'../handlers/admin_categorias_alta.ashx'"], src.match(/'[^']*(\.ashx|\/api\/|https?:)[^']*'/g));
  Check('U2 sin XMLHttpRequest / sendBeacon', false, /XMLHttpRequest|sendBeacon/.test(src));
});

// ---- S ----
pruebas.push(function () {
  var doc = Documento(), pedidos = [];
  var pedir = function (url) {
    pedidos.push(url);
    if (/admin_categorias_alta/.test(url)) return Promise.resolve(Respuesta(200, { rutas: ['/A'] }));
    return Promise.resolve(Respuesta(500, { error: 'sin datos en la prueba' }));
  };
  var v = Elemento('window');
  (new Function('window', leer('assets/js/escape.js')))(v);
  (new Function('window', leer('assets/js/duracion.js')))(v);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(v, v.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(v, doc);
  (new Function('window', leer('admin/cascada-organizacional.js')))(v);
  (new Function('window', 'Escape', 'fetch', leer('admin/categorias-alta.js')))(v, v.Escape, pedir);
  (new Function('window', leer('assets/js/seleccion-kpi.js')))(v);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', 'fetch', leer('admin/registro-iniciativas.js')))(v, doc, v.Catalogos, v.Escape, v.Duracion, pedir);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    v, doc, v.Catalogos, v.Escape, v.GloboAyuda, pedir);
  var pg = v.IniciativasPagina;
  var altas = function () { return pedidos.filter(function (u) { return /admin_categorias_alta/.test(u); }).length; };
  return esperar().then(function () {
    Check('S1 al cargar la pagina no se pide', 0, altas());
    pg.fijarRol('MOD');
    pg.mostrarVista('administracion');
    return esperar();
  }).then(function () {
    Check('S2 MOD: no abre ni pide', ['iniciativas', 0], [pg.vista, altas()]);
    pg.fijarRol('ADM');
    doc.getElementById('tab-administracion').disparar('click');
    return esperar();
  }).then(function () {
    Check('S3 ADM: abrir Administracion no pide nada al handler de alta', ['administracion', 0], [pg.vista, altas()]);
  });
});

pruebas.reduce(function (c, p) { return c.then(p); }, Promise.resolve())
  .then(function () {
    console.log('');
    console.log(fallos === 0 ? 'TODO PASO' : fallos + ' FALLO(S)');
    process.exitCode = fallos === 0 ? 0 : 1;
  }, function (e) { console.error(e); process.exitCode = 1; });
