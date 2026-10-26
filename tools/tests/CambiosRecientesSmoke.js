/* =========================================================================
   tools/tests/CambiosRecientesSmoke.js

   Prueba en node de admin/cambios-recientes.js ("Cambios recientes",
   Administracion, solo ADM), sin navegador ni servidor. Datos sinteticos.

   Casos:
     R) render: titulo/estado del registro cargado, orden del servidor, Alta
        o Cambio, escape; folio que no esta en el registro NO se descarta
        (aviso + "Actualizar registro"); registro aun sin cargar.
     V) VistaCambiosRecientes: cargando / listo / vacio / sin_columna /
        error (500, 403, red) / reintentar; respuesta superada se descarta;
        "Ver" abre solo lo que esta en el registro; "Actualizar registro"
        relee y marca lo que sigue faltando; solo GET.
     S) con la pagina real (admin/iniciativas.js): MOD no abre
        Administracion ni pide la lista; ADM la pide al abrirla y cada vez
        que vuelve; "Ver" usa abrirDesdeLista del registro (mismo detalle,
        sin cargar() ni tocar filtros) y "Actualizar registro" usa
        actualizar().
     H) HTML: seccion data-solo-adm dentro del panel de Administracion,
        nace oculta, dice el alcance (Dashboard; no SSMS ni Excel).

   Correr: node tools/tests/CambiosRecientesSmoke.js
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
    id: id, textContent: '', hidden: false, innerHTML: '', value: '', disabled: false, className: '', style: {},
    classList: {
      add: function (c) { clases[c] = true; }, remove: function (c) { delete clases[c]; },
      toggle: function (c, v) { if (v) clases[c] = true; else delete clases[c]; },
      contains: function (c) { return !!clases[c]; }
    },
    setAttribute: function (k, v) { atributos[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(atributos, k) ? atributos[k] : null; },
    closest: function () { return this; },
    focus: function () {},
    hijos: [], offsetWidth: 200,
    appendChild: function (h) { this.hijos.push(h); return h; },
    contains: function (otro) { return otro === this; },
    matches: function () { return false; },
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
// Un "boton" de la lista: solo lo que el modulo lee del clic.
function Boton(attrs) {
  return { closest: function () { return this; }, getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; } };
}
function Respuesta(status, cuerpo) {
  return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(cuerpo); } };
}
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

var v = {};
(new Function('window', leer('assets/js/escape.js')))(v);
(new Function('window', 'Escape', 'fetch', leer('admin/cambios-recientes.js')))(v, v.Escape, function () { throw new Error('fetch real'); });
var C = v.CambiosRecientes;

function Registro(iniciativas) {
  return { iniciativas: iniciativas, buscar: function (f) { return iniciativas.filter(function (i) { return i.folio === f; })[0] || null; } };
}
var REG = Registro([
  { folio: 'PRB 2026-000001', titulo: 'Uno <b>', estado: 'En Solución' },
  { folio: 'PRB 2026-000002', titulo: 'Dos', estado: 'En Análisis' }
]);
var CAMBIOS = [
  { folio: 'PRB 2026-000002', fecha_utc: '2026-10-20T16:05:00Z', usuario: 'SORIANA\\t_adm', accion: 'cambio' },
  { folio: 'PRB 2026-000099', fecha_utc: '2026-10-20T15:00:00Z', usuario: 'SORIANA\\t_adm', accion: 'cambio' },
  { folio: 'PRB 2026-000001', fecha_utc: '2026-10-19T12:00:00Z', usuario: 'SORIANA\\t_otro<i>', accion: 'alta' }
];
var OK = { estado: 'ok', limite: 10, alcance: 'Solo cambios guardados desde el Dashboard (alta, edición o solicitud aplicada). No incluye cambios hechos en SQL Server Management Studio ni por la carga del Excel.', cambios: CAMBIOS };

var pruebas = [];

// ---- R: render ----
pruebas.push(function () {
  var html = C.htmlLista(CAMBIOS, REG, {});
  var orden = (html.match(/PRB 2026-0000\d\d/g) || []).filter(function (x, n, a) { return a.indexOf(x) === n; });
  Check('R1 orden del servidor (mas reciente primero), sin reordenar', ['PRB 2026-000002', 'PRB 2026-000099', 'PRB 2026-000001'], orden);
  Check('R2 titulo y estado del registro; Alta / Cambio', [true, true, true, true],
    [/Dos<span class="ini-sub">En Análisis/.test(html), /<td>Cambio<\/td>/.test(html), /<td>Alta<\/td>/.test(html),
     /data-cr-folio="PRB 2026-000002">Ver/.test(html)]);
  Check('R3 escape de titulo y usuario', [true, false, true, false],
    [/Uno &lt;b&gt;/.test(html), html.indexOf('Uno <b>') >= 0, /t_otro&lt;i&gt;/.test(html), html.indexOf('t_otro<i>') >= 0]);
  Check('R4 folio fuera del registro: se muestra con aviso, sin "Ver", y se ofrece releer', [true, false, true],
    [/PRB 2026-000099<\/td><td><span class="ini-cr-falta">No está en el registro de Iniciativas cargado/.test(html),
     /data-cr-folio="PRB 2026-000099"/.test(html), /data-cr-releer/.test(html)]);
  var sin = C.htmlLista(CAMBIOS, null, {});
  Check('R5 registro aun sin cargar: filas visibles, ninguna se abre, sin "releer"', [3, false, false, true],
    [(sin.match(/<tr><td>/g) || []).length, /data-cr-folio/.test(sin), /data-cr-releer/.test(sin), /todavía no está cargado/.test(sin)]);
  var otra = C.htmlLista(CAMBIOS, REG, { 'PRB 2026-000099': true });
  Check('R6 tras releer y seguir faltando: lo dice, no lo quita', [true, 3], [/Sigue sin aparecer/.test(otra), (otra.match(/<tr><td>/g) || []).length]);
  Check('R7 todo en el registro: sin boton de releer', false, /data-cr-releer/.test(C.htmlLista([CAMBIOS[0]], REG, {})));
  // El mismo folio dos veces (su ultimo cambio y su alta) y una solicitud
  // aplicada: cada fila con su rotulo y su "Ver".
  var dos = C.htmlLista([
    { folio: 'PRB 2026-000001', fecha_utc: '2026-10-21T10:00:00Z', usuario: 'SORIANA\\t_adm', accion: 'solicitud' },
    { folio: 'PRB 2026-000001', fecha_utc: '2026-10-19T12:00:00Z', usuario: 'SORIANA\\t_otro', accion: 'alta' },
    { folio: 'PRB 2026-000002', fecha_utc: '2026-10-18T12:00:00Z', usuario: 'SORIANA\\t_adm', accion: 'otra<x>' }
  ], REG, {});
  Check('R8 Solicitud aplicada, Alta del mismo folio, accion desconocida tal cual (escapada, no "Cambio")',
    [['Solicitud aplicada', 'Alta', 'otra&lt;x&gt;'], 3],
    [(dos.match(/<\/td><td>([^<]*)<\/td><td>\d\d\//g) || []).map(function (s) { return s.replace(/^<\/td><td>|<\/td><td>\d\d\/$/g, ''); }),
     (dos.match(/data-cr-folio="[^"]+">Ver/g) || []).length]);
});

// ---- V: la vista ----
function Vista(respuestas, registro, abiertos, releidas) {
  var doc = Documento(), pedidos = [], n = 0;
  var pedir = function (url, op) {
    pedidos.push({ url: url, op: op });
    var r = respuestas[Math.min(n++, respuestas.length - 1)];
    return typeof r === 'function' ? r() : Promise.resolve(r);
  };
  var vista = new C.VistaCambiosRecientes(doc, pedir, function () { return registro.actual; },
    function (f) { abiertos.push(f); }, function () { releidas.push(1); return Promise.resolve(); });
  return { doc: doc, vista: vista, pedidos: pedidos };
}
function estados(doc) {
  return ['crCargando', 'crError', 'crVacio', 'crLista'].filter(function (id) { return !doc.getElementById(id).hidden; });
}

pruebas.push(function () {
  var reg = { actual: REG }, abiertos = [], releidas = [];
  var t = Vista([Respuesta(200, OK)], reg, abiertos, releidas);
  var p = t.vista.abrir();
  Check('V1 al abrir: solo "cargando"', ['crCargando'], estados(t.doc));
  return p.then(function () {
    Check('V2 listo: lista con las 3 filas; GET sin cuerpo, sin cache', [['crLista'], 3, '../handlers/admin_iniciativas_recientes.ashx', undefined, 'no-store'],
      [estados(t.doc), (t.doc.getElementById('crLista').innerHTML.match(/<tr><td>/g) || []).length, t.pedidos[0].url, t.pedidos[0].op.method, t.pedidos[0].op.cache]);
    Check('V3 el alcance del servidor se pinta', true, /desde el Dashboard/.test(t.doc.getElementById('crAlcance').textContent));
    t.doc.getElementById('crLista').disparar('click', { target: Boton({ 'data-cr-folio': 'PRB 2026-000002' }) });
    Check('V4 "Ver" de una que esta en el registro: abre su detalle', ['PRB 2026-000002'], abiertos);
    Check('V5 un folio que no esta: no abre nada', [false, 1], [t.vista.verIniciativa('PRB 2026-000099'), abiertos.length]);
    t.doc.getElementById('crLista').disparar('click', { target: Boton({ 'data-cr-releer': '' }) });
    return esperar().then(function () {
      Check('V6 "Actualizar registro": relee (una vez) y lo que sigue faltando lo dice, sin quitarlo', [1, true, 3],
        [releidas.length, /Sigue sin aparecer/.test(t.doc.getElementById('crLista').innerHTML),
         (t.doc.getElementById('crLista').innerHTML.match(/<tr><td>/g) || []).length]);
      reg.actual = Registro(REG.iniciativas.concat([{ folio: 'PRB 2026-000099', titulo: 'Nueva', estado: 'En Análisis' }]));
      t.doc.getElementById('crLista').disparar('click', { target: Boton({ 'data-cr-releer': '' }) });
      return esperar();
    }).then(function () {
      Check('V7 si al releer ya aparece: se puede ver', [true, true],
        [/data-cr-folio="PRB 2026-000099">Ver/.test(t.doc.getElementById('crLista').innerHTML), t.vista.verIniciativa('PRB 2026-000099')]);
    });
  });
});

pruebas.push(function () {
  var casos = [
    ['V8 vacio', Respuesta(200, { estado: 'ok', cambios: [] }), ['crVacio'], /Todavía no hay cambios guardados desde el Dashboard/],
    ['V9 sin sql/23', Respuesta(200, { estado: 'sin_columna', cambios: [] }), ['crVacio'], /no están habilitados/],
    ['V10 500', Respuesta(500, { error: 'Fallo X', tipo: 'SqlException' }), ['crError'], /Fallo X/],
    ['V11 403 (MOD)', Respuesta(403, { error: 'Solo un administrador (ADM) ve los cambios recientes.', tipo: 'RolInsuficiente' }), ['crError'], /Solo un administrador/],
    ['V12 respuesta rara', Respuesta(200, { nada: 1 }), ['crError'], /Respuesta 200/],
    ['V13 red caida', function () { return Promise.reject(new Error('red')); }, ['crError'], /No se pudo contactar/]
  ];
  return casos.reduce(function (cadena, c) {
    return cadena.then(function () {
      var t = Vista([c[1]], { actual: REG }, [], []);
      return t.vista.abrir().then(function () {
        var texto = t.doc.getElementById('crVacioTexto').textContent + t.doc.getElementById('crErrorTexto').textContent;
        Check(c[0] + ': un solo estado, con su texto; nunca lista vacia', [c[2], true, ''], [estados(t.doc), c[3].test(texto), t.doc.getElementById('crLista').innerHTML]);
      });
    });
  }, Promise.resolve());
});

pruebas.push(function () {
  var t = Vista([Respuesta(500, { error: 'uno' }), Respuesta(200, OK)], { actual: REG }, [], []);
  return t.vista.abrir().then(function () {
    t.doc.getElementById('crReintentar').disparar('click');
    return esperar().then(esperar);
  }).then(function () {
    Check('V14 reintentar tras error: listo', ['crLista'], estados(t.doc));
  });
});

pruebas.push(function () {
  var soltar;
  var lenta = function () { return new Promise(function (ok) { soltar = function () { ok(Respuesta(200, { estado: 'ok', cambios: [CAMBIOS[2]] })); }; }); };
  var t = Vista([lenta, Respuesta(200, OK)], { actual: REG }, [], []);
  var p1 = t.vista.abrir();
  var p2 = t.vista.cargar();
  return p2.then(function () {
    soltar();
    return p1;
  }).then(function () {
    Check('V15 una respuesta superada no pisa la nueva', 3, (t.doc.getElementById('crLista').innerHTML.match(/<tr><td>/g) || []).length);
  });
});

pruebas.push(function () {
  var src = leer('admin/cambios-recientes.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  Check('V16 el modulo no escribe: sin POST/PUT/DELETE', false, /method\s*:\s*'(POST|PUT|PATCH|DELETE)'/.test(src));
});

// ---- S: con la pagina real ----
pruebas.push(function () {
  var doc = Documento(), pedidos = [];
  var pedir = function (url) {
    pedidos.push(url);
    if (/admin_iniciativas_recientes/.test(url)) return Promise.resolve(Respuesta(200, OK));
    return Promise.resolve(Respuesta(500, { error: 'sin datos en la prueba' }));
  };
  var w = Elemento('window');
  (new Function('window', leer('assets/js/escape.js')))(w);
  (new Function('window', leer('assets/js/duracion.js')))(w);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(w, w.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(w, doc);
  (new Function('window', leer('admin/cascada-organizacional.js')))(w);
  (new Function('window', leer('assets/js/seleccion-kpi.js')))(w);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', 'fetch', leer('admin/registro-iniciativas.js')))(w, doc, w.Catalogos, w.Escape, w.Duracion, pedir);
  (new Function('window', 'Escape', 'fetch', leer('admin/cambios-recientes.js')))(w, w.Escape, pedir);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    w, doc, w.Catalogos, w.Escape, w.GloboAyuda, pedir);
  var pg = w.IniciativasPagina;
  var recientes = function () { return pedidos.filter(function (u) { return /admin_iniciativas_recientes/.test(u); }).length; };
  return esperar().then(function () {
    Check('S1 al cargar la pagina no se pide la lista', 0, recientes());
    pg.fijarRol('MOD');
    pg.mostrarVista('administracion');
    Check('S2 MOD: no abre Administracion ni pide la lista', ['iniciativas', 0], [pg.vista, recientes()]);
    pg.fijarRol('ADM');
    // El registro de la pagina: se sustituyen sus datos y se espian sus
    // metodos (los que usa "Cambios recientes").
    var reg = pg.registro, llamadas = [];
    reg.registro = REG;
    reg.abrirDesdeLista = function (f) { llamadas.push('abrirDesdeLista:' + f); return true; };
    reg.actualizar = function () { llamadas.push('actualizar'); return Promise.resolve({ ok: true }); };
    reg.cargar = function () { llamadas.push('cargar'); return Promise.resolve(); };
    var filtroAntes = reg.filtro;
    doc.getElementById('tab-administracion').disparar('click');
    return esperar().then(esperar).then(function () {
      Check('S3 ADM: abrir Administracion pide la lista y la pinta', ['administracion', 1, false],
        [pg.vista, recientes(), doc.getElementById('crLista').hidden]);
      doc.getElementById('crLista').disparar('click', { target: Boton({ 'data-cr-folio': 'PRB 2026-000002' }) });
      Check('S4 "Ver": pasa a Iniciativas y abre el MISMO detalle (abrirDesdeLista), sin cargar() ni tocar filtros',
        ['iniciativas', ['abrirDesdeLista:PRB 2026-000002'], true], [pg.vista, llamadas.slice(), reg.filtro === filtroAntes]);
      doc.getElementById('tab-administracion').disparar('click');
      return esperar().then(esperar);
    }).then(function () {
      Check('S5 volver a Administracion: la pide otra vez (lo recien guardado aparece)', 2, recientes());
      doc.getElementById('crLista').disparar('click', { target: Boton({ 'data-cr-releer': '' }) });
      return esperar();
    }).then(function () {
      Check('S6 "Actualizar registro" usa actualizar() (conserva la vista), nunca cargar()', [true, false],
        [llamadas.indexOf('actualizar') >= 0, llamadas.indexOf('cargar') >= 0]);
    });
  });
});

// ---- H: HTML ----
pruebas.push(function () {
  var html = leer('admin/iniciativas.html');
  var sinCom = html.replace(/<!--[\s\S]*?-->/g, '');
  Check('H1 seccion con data-solo-adm, nace oculta, dentro del panel de Administracion', [true, true],
    [/<section class="ini-adm-bloque ini-cr" id="crSeccion" aria-labelledby="crTitulo" data-solo-adm hidden>/.test(sinCom),
     sinCom.indexOf('id="crSeccion"') > sinCom.indexOf('id="panel-administracion"') &&
     sinCom.indexOf('id="crSeccion"') < sinCom.indexOf('id="panel-crear-admin"')]);
  Check('H2 titulo y alcance explicito (Dashboard; no SSMS ni Excel)', [true, true],
    [/<h3 class="ini-lista-titulo" id="crTitulo">Cambios recientes<\/h3>/.test(sinCom),
     /Solo cambios guardados desde el Dashboard[^<]*No incluye cambios hechos en SQL Server Management Studio ni por la carga del Excel/.test(sinCom)]);
  Check('H3 el script va antes de iniciativas.js', true,
    sinCom.indexOf('<script src="cambios-recientes.js"></script>') > 0 &&
    sinCom.indexOf('<script src="cambios-recientes.js"></script>') < sinCom.indexOf('<script src="iniciativas.js"></script>'));
});

pruebas.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  console.log(fallos ? 'FALLOS: ' + fallos : 'OK: todo paso');
  process.exit(fallos ? 1 : 0);
}, function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
