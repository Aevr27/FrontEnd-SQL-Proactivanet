/* =========================================================================
   tools/tests/CategoriasDuenosSmoke.js

   Prueba en node de admin/categorias-duenos.js (Administracion -> Dueños de
   categoria), sin navegador ni servidor. Datos sinteticos (nombres "PO 1",
   "Dir A"...), nunca personas reales.

   Casos:
     J) desdeJson: respuesta rara lanza (no se pinta como "sin categorias").
     O) origen: propio / heredado (con la fila fuente) / falta.
     H) hallazgos: no_vigente, repetida, sin_c1, falta, fuente_no_vigente,
        persona_desconocida.
     F) filtros y busqueda (sin acentos ni mayusculas).
     D) dependientes de la fila fuente de un C1.
     P) PropuestaDuenos: consistencia con lo resuelto por el servidor; solo
        nombres de CatPersona; vista previa con dependientes; nunca guardado.
     V) VistaDuenos: carga perezosa una sola vez; cargando / error /
        reintentar / listo; "Guardar (no disponible)" deshabilitado; sin peticiones de escritura.
     S) Con la pagina real (admin/iniciativas.js): la seccion esta OCULTA
        por ahora (DUENOS_VISIBLES = false) y el catalogo de dueños no se
        pide ni al abrir Administracion con ADM.

   Correr: node tools/tests/CategoriasDuenosSmoke.js
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
function Respuesta(status, cuerpo) {
  return { ok: status >= 200 && status < 300, status: status, json: function () { return Promise.resolve(cuerpo); } };
}
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

var ventana = {};
(new Function('window', leer('assets/js/escape.js')))(ventana);
(new Function('window', leer('assets/js/duracion.js')))(ventana);
(new Function('window', 'Escape', leer('admin/categorias-duenos.js')))(ventana, ventana.Escape);
var CD = ventana.CategoriasDuenos;

// ---------------------------------------------------------------------------
// Datos: C1 "A" con fuente "A1"; "A2" hereda PO; "A3" dada de baja; "A2"
// repetida (no usada); "B1" sin C1 y sin Director; "C1x" hereda de una fuente
// dada de baja; "Ghost" no esta en CatPersona.
// ---------------------------------------------------------------------------
function Fila(n2, c1, po, so, dir, r, fuente, vigente, usada) {
  return { n2: n2, c1: c1, po: po, so: so, director: dir, resuelto: r, fuente_c1: fuente,
           vigente: vigente !== false, usada: usada !== false };
}
var JSON_DUENOS = {
  duenos: [
    Fila('A1', 'A', 'PO 1', 'SO 1', 'Dir A', { po: 'PO 1', so: 'SO 1', director: 'Dir A' }, 'A1'),
    Fila('A2', 'A', null, 'SO 2', null, { po: 'PO 1', so: 'SO 2', director: 'Dir A' }, 'A1'),
    Fila('A2', 'A', 'PO 2', 'SO 2', 'Dir A', { po: 'PO 1', so: 'SO 2', director: 'Dir A' }, 'A1', true, false),
    Fila('A3', 'A', 'PO 2', 'SO 1', 'Dir A', { po: 'PO 2', so: 'SO 1', director: 'Dir A' }, 'A1', false),
    Fila('B1', null, 'PO 2', 'Ghost', null, { po: 'PO 2', so: 'Ghost', director: null }, null),
    Fila('C0', 'C', 'PO 1', 'SO 1', 'Dir B', { po: 'PO 1', so: 'SO 1', director: 'Dir B' }, 'C0', false),
    Fila('C1x', 'C', null, 'SO 2', 'Dir B', { po: 'PO 1', so: 'SO 2', director: 'Dir B' }, 'C0'),
    { n2: '  ', c1: 'Z' }   // sin N2: se descarta
  ],
  personas: [
    { nombre: 'PO 1', rol: 'PO' }, { nombre: 'PO 2', rol: 'PO' }, { nombre: 'Sofía Ñandú', rol: 'SO' },
    { nombre: 'SO 1', rol: 'SO' }, { nombre: 'SO 2', rol: 'SO' }, { nombre: 'Dir A' }, { nombre: 'Dir B' },
    { nombre: 'dir a' }   // repetida (sin distinguir mayusculas): se descarta
  ]
};
var cat = CD.CatalogoDuenos.desdeJson(JSON.parse(JSON.stringify(JSON_DUENOS)));
function fila(n2, usada) { return cat.filas.filter(function (f) { return f.n2 === n2 && f.usada !== (usada === false); })[0]; }
function claves(h) { return h.map(function (x) { return x.clave + (x.campo ? ':' + x.campo : ''); }); }

// ---- J ----
['sin nada', { duenos: [] }, { personas: [] }, { duenos: {}, personas: [] }].forEach(function (j, i) {
  var lanzo = false;
  try { CD.CatalogoDuenos.desdeJson(i === 0 ? null : j); } catch (e) { lanzo = true; }
  Check('J1 respuesta rara #' + i + ' lanza', true, lanzo);
});
Check('J2 filas sin N2 descartadas; personas sin repetir', [7, 7], [cat.filas.length, cat.personas.length]);

// ---- O ----
Check('O1 propio', { tipo: 'propio', valor: 'PO 1', desde: null }, cat.origen(fila('A1'), 'po'));
Check('O2 heredado, con su fuente', { tipo: 'heredado', valor: 'PO 1', desde: 'A1' }, cat.origen(fila('A2'), 'po'));
Check('O3 falta', { tipo: 'falta', valor: null, desde: null }, cat.origen(fila('B1'), 'director'));
Check('O4 la fila usada es la que manda en un N2 repetido', 'SO 2', cat.fila('a2').propio.so);

// ---- H ----
Check('H1 fila limpia sin hallazgos', [], claves(cat.hallazgos(fila('A1'))));
Check('H2 dada de baja', ['no_vigente'], claves(cat.hallazgos(fila('A3'))));
Check('H3 N2 repetido no usado', ['repetida'], claves(cat.hallazgos(fila('A2', false))));
Check('H4 sin C1, persona desconocida y falta', ['sin_c1', 'persona_desconocida:so', 'falta:director'], claves(cat.hallazgos(fila('B1'))));
Check('H5 heredado de una fuente dada de baja', ['fuente_no_vigente:po'], claves(cat.hallazgos(fila('C1x'))));

// ---- F ----
function n2s(lista) { return lista.map(function (f) { return f.n2 + (f.usada ? '' : '*'); }); }
Check('F1 vigentes (incluye la repetida)', ['A1', 'A2', 'A2*', 'B1', 'C1x'], n2s(cat.filtrar('vigentes', '')));
Check('F2 dadas de baja', ['A3', 'C0'], n2s(cat.filtrar('no_vigentes', '')));
Check('F3 con heredados', ['A2', 'C1x'], n2s(cat.filtrar('heredadas', '')));
Check('F4 con faltantes', ['B1'], n2s(cat.filtrar('faltantes', '')));
Check('F5 filtro desconocido = vigentes', n2s(cat.filtrar('vigentes', '')), n2s(cat.filtrar('xx', '')));
Check('F6 busqueda por dueño heredado', ['A2', 'C1x'], n2s(cat.filtrar('vigentes', 'so 2')).filter(function (n) { return n !== 'A2*'; }));
Check('F7 resumen cuenta cada filtro', [5, 7, 2, 1], [cat.resumen().vigentes, cat.resumen().todas, cat.resumen().heredadas, cat.resumen().faltantes]);

// ---- D ----
Check('D1 la fuente sabe quien hereda de ella (solo usadas, sin valor propio)', ['A2'],
  cat.dependientes(fila('A1'), 'po').map(function (f) { return f.n2; }));
Check('D2 una fila que no es fuente no tiene dependientes', [], cat.dependientes(fila('A2'), 'po'));

// ---- P ----
var p1 = new CD.PropuestaDuenos(cat, fila('A1'));
Check('P1 consistente y habilitada', [true, true], [p1.consistente, p1.habilitada()]);
Check('P2 repetida (no usada): no se prepara', false, new CD.PropuestaDuenos(cat, fila('A2', false)).habilitada());
var malo = CD.CatalogoDuenos.desdeJson({ duenos: [Fila('X', 'X', 'PO 1', null, null, { po: 'PO 2', so: null, director: null }, 'X')], personas: [] });
Check('P3 si el calculo local no reproduce al servidor: sin vista previa', [false, false],
  [new CD.PropuestaDuenos(malo, malo.filas[0]).consistente, new CD.PropuestaDuenos(malo, malo.filas[0]).habilitada()]);
Check('P4 no acepta nombres fuera de CatPersona', [false, 'PO 1'], [p1.asignar('po', 'Alguien Inventado'), p1.valores.po]);
Check('P5 acepta un nombre de CatPersona con su grafia', [true, 'PO 2'], [p1.asignar('po', ' po 2 '), p1.valores.po]);
var v1 = p1.vista()[0];
Check('P6 vista previa: cambia y lista a la que hereda', [true, [{ n2: 'A2', anterior: 'PO 1', nuevo: 'PO 2' }]], [v1.cambia, v1.dependientes]);
var r1 = p1.revisar();
Check('P7 revisar: cambio, advertencia de dependientes, nunca guardado', [1, true, false, true],
  [r1.cambios.length, r1.advertencias.some(function (a) { return /hereda/.test(a); }), r1.guardado, /No se guard|no se guardó/i.test(r1.aviso)]);
p1.asignar('po', '');
Check('P8 dejar la fuente sin valor propio: falta (no se hereda de si misma) y avisa', ['falta', true],
  [p1.vista()[0].despues.tipo, p1.revisar().advertencias.some(function (a) { return /quedaría sin valor/.test(a); })]);
var pB = new CD.PropuestaDuenos(cat, fila('B1'));
Check('P9 valor actual fuera de CatPersona se ofrece marcado', { valor: 'Ghost', verificada: false }, pB.opciones('so')[0]);
Check('P10 y se puede conservar', true, pB.asignar('so', 'Ghost'));

// ---- V ----
function Vista(respuestas) {
  var doc = Documento(), pedidos = [];
  var pedir = function (url, op) {
    pedidos.push({ url: url, metodo: (op && op.method) || 'GET' });
    var r = respuestas.shift();
    return r instanceof Error ? Promise.reject(r) : Promise.resolve(r);
  };
  var v = new CD.VistaDuenos(doc, function () { return pedir; });
  return { v: v, doc: doc, pedidos: pedidos, $: function (id) { return doc.getElementById(id); } };
}
var pruebas = [];
pruebas.push(function () {
  var t = Vista([Respuesta(500, { error: 'El servidor de SQL rechazo la consulta (error 53).', tipo: 'SqlException' }),
                 Respuesta(200, JSON_DUENOS)]);
  var promesa = t.v.abrir();
  Check('V1 cargando mientras espera', [false, true, true], [t.$('cdCargando').hidden, t.$('cdError').hidden, t.$('cdContenido').hidden]);
  return promesa.then(function () {
    Check('V2 error del servidor: se ve el error real, no "sin categorias"', [true, false, true, true],
      [t.$('cdCargando').hidden, t.$('cdError').hidden, t.$('cdContenido').hidden, /error 53/.test(t.$('cdErrorTexto').textContent)]);
    t.$('cdReintentar').disparar('click');
    return t.v.carga;
  }).then(function () {
    Check('V3 reintentar carga y pinta', [true, false, 5], [t.$('cdError').hidden, t.$('cdContenido').hidden,
      (t.$('cdCuerpo').innerHTML.match(/<tr /g) || []).length]);
    return t.v.abrir();
  }).then(function () {
    Check('V4 abrir otra vez no vuelve a pedir; todo GET a ?duenos=1', [2, ['GET'], [CD.URL_DUENOS]],
      [t.pedidos.length, t.pedidos.map(function (p) { return p.metodo; }).filter(function (m, i, a) { return a.indexOf(m) === i; }),
       t.pedidos.map(function (p) { return p.url; }).filter(function (m, i, a) { return a.indexOf(m) === i; })]);
    var celda = Elemento('btn'); celda.setAttribute('data-n2', 'A1');
    t.$('cdCuerpo').disparar('click', { target: celda });
    var det = t.$('cdDetCuerpo').innerHTML;
    Check('V5 detalle: abierto, Guardar deshabilitado, aviso de no guardado', [false, true, true],
      [t.$('cdDetalle').hidden, /<button type="button" class="btn chico" disabled aria-describedby="cdGuardarNota">Guardar \(no disponible\)<\/button>/.test(det),
       /no se guardó nada/i.test(det)]);
    Check('V5b nota: solo vista previa; ningun boton "Guardar" a secas', [true, false],
      [/Solo vista previa: guardar se habilitará/.test(det), /<button[^>]*>\s*Guardar\s*<\/button>/.test(det)]);
    t.$('cdFiltro').value = 'faltantes';
    t.$('cdFiltro').disparar('change', { target: t.$('cdFiltro') });
    Check('V6 filtro cambia la lista', 1, (t.$('cdCuerpo').innerHTML.match(/<tr /g) || []).length);
  });
});
pruebas.push(function () {
  var t = Vista([Respuesta(200, { duenos: 'x' })]);
  return t.v.abrir().then(function () {
    Check('V7 respuesta sin la forma esperada = error, no lista vacia', [false, true],
      [t.$('cdError').hidden, t.$('cdContenido').hidden]);
  });
});
pruebas.push(function () {
  var t = Vista([new Error('red')]);
  return t.v.abrir().then(function () { Check('V8 red caida = error', false, t.$('cdError').hidden); });
});
pruebas.push(function () {
  var src = leer('admin/categorias-duenos.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  Check('V9 el modulo no escribe: sin POST/PUT/DELETE', false, /method\s*:\s*'(POST|PUT|PATCH|DELETE)'/.test(src));
});

// ---- S: con la pagina real ----
pruebas.push(function () {
  var doc = Documento(), pedidos = [];
  var pedir = function (url) {
    pedidos.push(url);
    if (/duenos=1/.test(url)) return Promise.resolve(Respuesta(200, JSON_DUENOS));
    return Promise.resolve(Respuesta(500, { error: 'sin datos en la prueba' }));
  };
  var v = Elemento('window');
  (new Function('window', leer('assets/js/escape.js')))(v);
  (new Function('window', leer('assets/js/duracion.js')))(v);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(v, v.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(v, doc);
  (new Function('window', leer('admin/cascada-organizacional.js')))(v);
  (new Function('window', 'Escape', 'fetch', leer('admin/categorias-duenos.js')))(v, v.Escape, pedir);
  (new Function('window', leer('assets/js/seleccion-kpi.js')))(v);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', 'fetch', leer('admin/registro-iniciativas.js')))(v, doc, v.Catalogos, v.Escape, v.Duracion, pedir);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    v, doc, v.Catalogos, v.Escape, v.GloboAyuda, pedir);
  var pg = v.IniciativasPagina;
  return esperar().then(function () {
    var duenos = function () { return pedidos.filter(function (u) { return /duenos=1/.test(u); }).length; };
    Check('S1 al cargar la pagina no se piden los dueños', 0, duenos());
    pg.fijarRol('MOD');
    pg.mostrarVista('administracion');
    Check('S2 MOD: no abre Administracion ni pide dueños', ['iniciativas', 0], [pg.vista, duenos()]);
    pg.fijarRol('ADM');
    doc.getElementById('tab-administracion').disparar('click');
    return esperar().then(function () {
    Check('S3 ADM: abrir Administracion no pide el catalogo de dueños (oculto)', ['administracion', 0], [pg.vista, duenos()]);
    Check('S3 la seccion de dueños queda oculta y el flag apagado', [true, false],
      [doc.getElementById('cdSeccion').hidden, v.Iniciativas.DUENOS_VISIBLES]);
    doc.getElementById('tab-iniciativas').disparar('click');
    doc.getElementById('tab-administracion').disparar('click');
    return esperar().then(function () { Check('S4 volver a abrirla tampoco lo pide', 0, duenos()); });
    });
  });
});

// C) La tabla vive en una caja de alto fijo con scroll y encabezado fijo.
pruebas.push(function () {
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  var css = leer('admin/iniciativas.css').replace(/\/\*[\s\S]*?\*\//g, '');
  Check('C0 la seccion de dueños nace oculta en el HTML', true,
    /<section class="ini-adm-bloque" id="cdSeccion" aria-labelledby="cdTitulo" hidden>/.test(html));
  Check('C1 la tabla de dueños va dentro de .ini-cd-caja', true,
    /<div class="ini-tabla-caja ini-cd-caja" id="cdTablaCaja">\s*<table class="ini-tabla">[\s\S]*?<tbody id="cdCuerpo">/.test(html));
  Check('C2 caja: alto maximo y scroll vertical propio', true,
    /\.ini-tabla-caja\.ini-cd-caja \{ max-height: 440px; overflow-y: auto; \}/.test(css));
  Check('C3 encabezado fijo con fondo', true,
    /\.ini-cd-caja thead th \{ position: sticky; top: 0;[^}]*background: #fff;/.test(css));
  Check('C4 bajo 760px conserva el scroll', true,
    /@media \(max-width: 760px\) \{\s*\.ini-tabla-caja\.ini-cd-caja \{ overflow-y: auto; \}/.test(css));
});

pruebas.reduce(function (c, p) { return c.then(p); }, Promise.resolve())
  .then(function () {
    console.log('');
    console.log(fallos === 0 ? 'TODO PASO' : fallos + ' FALLO(S)');
    process.exitCode = fallos === 0 ? 0 : 1;
  }, function (e) { console.error(e); process.exitCode = 1; });
