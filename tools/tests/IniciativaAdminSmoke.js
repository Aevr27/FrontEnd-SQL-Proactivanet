// tools/tests/IniciativaAdminSmoke.js - prueba de humo de la gestion directa
// de ADM en admin/iniciativas.html (admin/iniciativa-admin.js): alta,
// edicion y la marca derivada "Incompleta". PROTOTIPO sin persistencia.
//
// NO forma parte del sitio: vive fuera de admin/.
//
// Partes:
//   I) Incompleta: faltantes (vacio vs "no se sabe"), RCA solo en Problem,
//      datos de una iniciativa del registro.
//   B) BorradorAdmin: cualquier tipo, PRB sin RCA se prepara (incompleta),
//      solo el Tipo bloquea, formatos, categoria opcional, nunca codigo ni
//      guardado.
//   S) Separacion de roles: el alta de ADM no abre sin rol ADM; Nueva
//      solicitud conserva sus reglas (RCA obligatorio para Problem).
//   C) Panel "Crear iniciativa" sobre el DOM de mentira.
//   CB) Boton "+ Crear iniciativa": junto a "Solicitar", visible solo con
//      ADM (SesionAdmin real), dos pestañas intactas y borradores que
//      sobreviven a la navegacion.
//   E) Modificar (antes "Editar (Admin)") en el detalle del registro: solo ADM, cambios,
//      faltantes, formato, rol que cambia con el panel abierto.
//   M) Marca Incompleta en el detalle (para cualquier rol).
//   P) Nada se persiste: solo los dos GET de siempre, ninguna escritura en
//      el codigo nuevo.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\IniciativaAdminSmoke.js   # sale 0 si todo paso
//
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
// DOM de mentira (el mismo de IniciativasCascadaSmoke / RegistroIniciativasSmoke)
// ---------------------------------------------------------------------------
function Elemento(id) {
  var oyentes = {};
  var clases = {};
  var atributos = {};
  return {
    id: id, textContent: '', hidden: false, innerHTML: '', value: '', disabled: false,
    className: '', style: {}, offsetWidth: 200, hijos: [], enfocado: 0,
    classList: {
      add: function (c) { clases[c] = true; },
      remove: function (c) { delete clases[c]; },
      toggle: function (c, v) { if (v) clases[c] = true; else delete clases[c]; },
      contains: function (c) { return !!clases[c]; }
    },
    setAttribute: function (k, v) { atributos[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(atributos, k) ? atributos[k] : null; },
    appendChild: function (h) { this.hijos.push(h); return h; },
    contains: function (otro) { return otro === this; },
    matches: function () { return false; },
    focus: function () { this.enfocado++; },
    getBoundingClientRect: function () { return { left: 100, width: 80, bottom: 50 }; },
    addEventListener: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    disparar: function (tipo, evento) {
      var self = this;
      var e = evento || { target: self };
      (oyentes[tipo] || []).forEach(function (fn) { fn(e); });
    },
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
  doc.querySelectorAll = function () { return []; };
  doc.createElement = function () { return Elemento(''); };
  doc.body = Elemento('body');
  doc.documentElement = Elemento('html');
  doc.documentElement.clientWidth = 1200;
  return doc;
}

function Respuesta(status, cuerpo) {
  return { ok: status >= 200 && status < 300, status: status,
           json: function () { return Promise.resolve(cuerpo); } };
}
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------
var RUTAS = [
  { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' },
  { director: 'Dir A', po: 'PO 1', so: 'SO y', categoria: '/A/Cat 2' },
  { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 4' }
];
var CATALOGO = {
  tipos: [{ prefijo: 'PRB', nombre: 'Problem' }, { prefijo: 'ADO', nombre: 'Adopción' }, { prefijo: 'MAP', nombre: 'Mejora aplicativo' }],
  tipo_problem: 'PRB', rutas: RUTAS, rutas_sin_duenos: 0, rutas_duenos_no_vigentes: 0
};

function Ini(folio, o) {
  var i = {
    folio: folio, titulo: 'T ' + folio, titulo_problem: 'T ' + folio, agrup: 'Problem', estado: 'En Análisis',
    tickets_reduce: 0, vol_reduce_folio: 0, riesgo_folio: 0, retrazado: 0, sem_fecha: 'ambar',
    fecha_retrasada: false, f_analisis: '2026-12-01', f_solucion: null, f_cierre: null,
    n_analisis: 0, n_solucion: 0, n_cierre: 0, antiguedad: 10, po: null, so: null, director: null,
    manager: null, descripcion: 'Desc ' + folio, observaciones: 'Obs ' + folio,
    activa: true, seguimiento: true, sin_categoria: false, prefijo: 'PRB', categorias: []
  };
  Object.keys(o || {}).forEach(function (k) { i[k] = o[k]; });
  return i;
}
function Cat(ruta, pct) {
  return { categoria: ruta, tickets_reduce: 10, pct_dism: pct, director: 'Dir A', po: 'PO 1', so: 'SO x' };
}
var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'],
  agrupadores: ['Problem'], fecha_gen: '09/10/2026',
  tipos_iniciativa: CATALOGO.tipos,
  iniciativas: [
    Ini('PRB 2026-000001', { categorias: [Cat('/A/Cat 1', 0.5), Cat('/A/Cat 2', 0.25)] }),       // completa
    Ini('PRB 2026-000002', { sin_categoria: true, observaciones: null }),                        // sin categoria ni obs.
    Ini('MAP 2026-000003', { prefijo: 'MAP', estado: 'En Solución', f_solucion: null,
                             categorias: [Cat('/A/Cat 2', null)] })                                // sin % y sin fecha
  ]
};

// Carga la pagina con un `pedir` que registra TODO lo que se pide.
function Pagina(conAdmin) {
  var ventana = Elemento('window');
  var documento = Documento();
  var pedidos = [];
  function pedir(url, opciones) {
    pedidos.push({ url: url, metodo: (opciones && opciones.method) || 'GET' });
    if (/registro/.test(url)) return Promise.resolve(Respuesta(200, JSON.parse(JSON.stringify(REGISTRO))));
    if (/catalogos/.test(url)) return Promise.resolve(Respuesta(200, CATALOGO));
    return Promise.reject(new Error('peticion inesperada ' + url));
  }
  (new Function('window', leer('assets/js/escape.js')))(ventana);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(ventana, ventana.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(ventana, documento);
  (new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
  if (conAdmin !== false) {
    (new Function('window', 'document', 'Catalogos', 'Escape', leer('admin/iniciativa-admin.js')))(
      ventana, documento, ventana.Catalogos, ventana.Escape);
  }
  (new Function('window', 'document', 'Catalogos', 'Escape', 'fetch', leer('admin/registro-iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, pedir);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.GloboAyuda, pedir);
  return {
    ventana: ventana, doc: documento, pedidos: pedidos,
    sel: function (id) { return documento.getElementById(id); },
    pagina: ventana.IniciativasPagina, registro: ventana.IniciativasPagina.registro
  };
}

function escribir(p, id, valor) { var el = p.sel(id); el.value = valor; el.disparar('input'); }
function elegir(p, id, valor) { var el = p.sel(id); el.value = valor; el.disparar('change'); }
function accion(p, nombre) {
  var b = Elemento('boton');
  b.setAttribute('data-accion', nombre);
  p.sel('regDetCuerpo').disparar('click', { target: b });
}
// Un control pintado dentro del detalle: el evento llega por delegacion.
function editar(p, attr, valor, texto) {
  var t = Elemento('control');
  t.setAttribute(attr, valor);
  t.value = texto;
  p.sel('regDetCuerpo').disparar('input', { target: t });
}
function claves(lista) { return lista.map(function (f) { return f.clave; }); }

var base = Pagina();
var A = base.ventana.IniciativaAdmin;
var I = base.ventana.Iniciativas;
var pruebas = [];

// ---------------------------------------------------------------------------
// I) Incompleta
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var completo = { categoria: '/A', titulo: 't', descripcion: 'd', observaciones: 'o', volumetria: '3', pct: '10', rca: 'x.pdf' };
  Check('I1 completo: sin faltantes', [], A.Incompleta.faltantes(completo, true));
  Check('I2 vacios y null cuentan, en orden del formulario',
    ['categoria', 'titulo', 'observaciones', 'pct'],
    claves(A.Incompleta.faltantes({ categoria: '', titulo: '  ', descripcion: 'd', observaciones: null, volumetria: '0', pct: '' }, false)));
  Check('I3 undefined = el origen no lo trae: no cuenta', [], A.Incompleta.faltantes({ titulo: 't' }, true));
  Check('I4 RCA solo cuenta en Problem', [['rca'], []],
    [claves(A.Incompleta.faltantes({ rca: '' }, true)), claves(A.Incompleta.faltantes({ rca: '' }, false))]);
  Check('I5 la marca no es columna: CAMPOS_INCOMPLETA sin Tipo ni codigo', false,
    A.CAMPOS_INCOMPLETA.some(function (c) { return c.clave === 'tipo' || c.clave === 'codigo'; }));

  function deReg(i) { return claves(A.Incompleta.faltantes(A.Incompleta.datosDeRegistro(i), false)); }
  Check('I6 registro completo', [], deReg(REGISTRO.iniciativas[0]));
  Check('I7 sin categoria: solo Categoria (ni el % ni Observaciones)', ['categoria'], deReg(REGISTRO.iniciativas[1]));
  Check('I8 % nulo en una categoria: solo %, aunque falte la fecha del estado', ['pct'], deReg(REGISTRO.iniciativas[2]));
  Check('I9 existente sin Titulo, Descripcion, Observaciones ni fecha de analisis: no se marca', [],
    deReg(Ini('X 1', { titulo: '', titulo_problem: '', descripcion: null, observaciones: null, f_analisis: null,
                      categorias: [Cat('/A', 0.1)] })));
  Check('I10 existente: solo Categoria y % salen del registro', ['categoria', 'pct'],
    Object.keys(A.Incompleta.datosDeRegistro(REGISTRO.iniciativas[0])));
  Check('I11 CAMPOS_REGISTRO = Categoria y %', ['categoria', 'pct'], A.Incompleta.CAMPOS_REGISTRO);
  Check('I12 el borrador conserva la lista completa', ['categoria', 'titulo', 'descripcion', 'observaciones', 'volumetria', 'pct', 'rca'],
    A.CAMPOS_INCOMPLETA.map(function (c) { return c.clave; }));
});

// ---------------------------------------------------------------------------
// B) BorradorAdmin
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var cat = I.CatalogoIniciativas.desdeJson(CATALOGO);
  var b = new A.BorradorAdmin(cat);
  var r = b.revisar();
  Check('B1 sin tipo: bloquea solo el Tipo', [false, ['tipo']], [r.listo, claves(r.bloqueantes)]);

  Check('B2 acepta cualquier tipo del catalogo', [true, true, true],
    cat.tipos.map(function (t) { return new A.BorradorAdmin(cat).elegirTipo(t); }));
  Check('B3 tipo fuera del catalogo no se acepta', [false, ''], [b.elegirTipo('XYZ'), b.tipo]);

  b.elegirTipo('PRB');
  r = b.revisar();
  Check('B4 PRB vacio y sin RCA se puede preparar (no bloquea)', true, r.listo);
  Check('B5 ... y queda incompleta, con RCA entre los faltantes',
    [true, ['categoria', 'titulo', 'descripcion', 'observaciones', 'volumetria', 'pct', 'rca']], [r.incompleta, claves(r.faltantes)]);
  Check('B6 nunca codigo ni guardado; siempre el aviso de prototipo', [null, false, true],
    [r.codigo, r.guardado, /no se guardó nada/.test(r.aviso)]);

  b.elegirTipo('ADO');
  Check('B7 otro tipo sin RCA: el RCA no falta', false, claves(b.faltantes()).indexOf('rca') >= 0);

  Check('B8 la categoria se elige sin PO ni SO (todo opcional)', [true, '/B/Cat 4'], [b.elegir(2, '/B/Cat 4'), b.categoria()]);
  Check('B9 categoria fuera del catalogo no se acepta', [false, ''], [b.elegir(2, '/Inventada'), b.categoria()]);

  b.capturar('pct', '150');
  b.capturar('volumetria', '2.5');
  r = b.revisar();
  Check('B10 formatos invalidos si bloquean', [false, ['volumetria', 'pct']], [r.listo, claves(r.formato)]);

  b.elegirTipo('PRB');
  b.elegir(2, '/A/Cat 1');
  ['titulo', 'descripcion', 'observaciones'].forEach(function (k) { b.capturar(k, 'x'); });
  b.capturar('volumetria', '12');
  b.capturar('pct', '25.5');
  b.elegirRca({ name: 'rca.pdf', size: 10 });
  r = b.revisar();
  Check('B11 completo: listo, sin faltantes, aun sin guardar', [true, false, [], false], [r.listo, r.incompleta, r.faltantes, r.guardado]);
  b.elegirRca({ name: 'vacio.pdf', size: 0 });
  Check('B12 archivo vacio no cuenta como RCA', ['rca'], claves(b.faltantes()));
});

// ---------------------------------------------------------------------------
// S) Separacion de roles + C) panel de alta
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var pg = p.pagina;
    p.sel('btnCrearAdmin').disparar('click');
    Check('S1 sin rol: Crear (Admin) no abre', ['iniciativas', true], [pg.vista, p.sel('panel-crear-admin').hidden]);
    pg.fijarRol('MOD');
    p.sel('btnCrearAdmin').disparar('click');
    Check('S2 MOD: no abre', 'iniciativas', pg.vista);
    pg.fijarRol('adm');
    Check('S3 rol desconocido = sin rol', null, pg.rol);
    pg.fijarRol('ADM');
    p.sel('btnCrearAdmin').disparar('click');
    Check('S4 ADM: abre su propio panel, no Nueva solicitud', ['crear', false, true],
      [pg.vista, p.sel('panel-crear-admin').hidden, p.sel('panel-nueva').hidden]);
    pg.fijarRol('MOD');
    Check('S5 perder ADM con el panel abierto vuelve a Iniciativas', ['iniciativas', true], [pg.vista, p.sel('panel-crear-admin').hidden]);

    // Nueva solicitud intacta: PRB sigue exigiendo RCA y todo lo demas.
    var s = pg.solicitud;
    s.elegirTipo('PRB');
    Check('S6 Nueva solicitud: PRB exige RCA y todos los campos', true,
      ['tipo', 'po', 'so', 'categoria', 'titulo', 'analisis', 'observaciones', 'volumetria', 'pct', 'rca'].slice(1)
        .every(function (k) { return s.faltantes().indexOf(k) >= 0; }));
    Check('S7 borradores separados: el de ADM no es el de la solicitud', true, pg.crearAdmin.borrador !== s);

    // C) el panel
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    Check('C1 tipos del catalogo con su Descripcion', ['PRB', 'ADO', 'MAP'], p.sel('admTipo').opciones());
    Check('C2 categoria habilitada sin elegir PO (cascada opcional)', [false, ['/A/Cat 1', '/A/Cat 2', '/B/Cat 4']],
      [p.sel('admCategoria').disabled, p.sel('admCategoria').opciones()]);
    elegir(p, 'admTipo', 'PRB');
    Check('C3 aviso en vivo: incompleta, con RCA', true,
      /Incompleta/.test(p.sel('admFaltantes').innerHTML) && /RCA/.test(p.sel('admFaltantes').innerHTML));
    Check('C4 nota RCA de Problem: no bloquea', true, /sin RCA queda incompleta/.test(p.sel('admRcaNota').textContent));
    escribir(p, 'adm-titulo', 'Caída de X');
    Check('C5 escribir quita el faltante', false, /Título/.test(p.sel('admFaltantes').innerHTML));
    elegir(p, 'admCategoria', '/B/Cat 4');
    Check('C6 Director derivado de la categoria', 'Dir B', p.sel('admDirector').textContent);
    p.sel('admRevisar').disparar('click');
    var res = p.sel('admResultado');
    Check('C7 Revisar: "no guardado" + aviso de prototipo, nunca clase ok', [false, true, true, false],
      [res.hidden, /no guardado/.test(res.innerHTML), /no se guardó nada/.test(res.innerHTML), res.classList.contains('ok')]);
    Check('C8 el codigo no se inventa', 'Se asigna al guardar (regla pendiente)',
      (/<output id="admCodigo"[^>]*>([^<]*)<\/output>/.exec(leer('admin/iniciativas.html')) || [])[1]);
  });
});

// ---------------------------------------------------------------------------
// E) Modificar (antes "Editar (Admin)") + M) marca Incompleta en el detalle
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    reg.abrirDetalle('PRB 2026-000001');
    Check('E1 sin rol: sin boton de editar', false, />Modificar<\/button>/.test(p.sel('regDetCuerpo').innerHTML));
    accion(p, 'editar-admin');
    Check('E2 sin rol: la accion no abre nada', [null, true], [reg.edicion, p.sel('regEdicion').hidden]);
    Check('E3 Solicitar cambios sigue ahi', true, /Solicitar cambios/.test(p.sel('regDetCuerpo').innerHTML));

    p.pagina.fijarRol('ADM');
    Check('E4 ADM con el detalle abierto: aparece el boton', true, />Modificar<\/button>/.test(p.sel('regDetAcciones').innerHTML));
    accion(p, 'editar-admin');
    var html = p.sel('regEdicion').innerHTML;
    Check('E5 abre el formulario con aviso de prototipo y Guardar deshabilitado', [false, true, true],
      [p.sel('regEdicion').hidden, /Prototipo/.test(html), /<button type="button" class="btn chico" disabled/.test(html)]);
    Check('E6 lista lo que no es editable, con motivo', true,
      /Fechas compromiso/.test(html) && /pendiente de contrato/.test(html) && /solo lectura/.test(html));

    editar(p, 'data-edicion', 'titulo', 'Nuevo titulo');
    editar(p, 'data-edicion', 'descripcion', '');
    editar(p, 'data-edicion-pct', '1', '30');
    var r = reg.revisarEdicion();
    Check('E7 cambios detectados', ['titulo', 'descripcion', 'pct'], claves(r.cambios));
    Check('E8 vaciar Descripcion NO marca incompleta a una existente', [true, false, []],
      [r.listo, r.incompleta, claves(r.faltantes)]);
    Check('E9 nunca guardado; el mensaje lo dice', [false, true],
      [r.guardado, /no guardados/.test(p.sel('regEdMsg').innerHTML) && /no se guardó nada/.test(p.sel('regEdMsg').innerHTML)]);
    editar(p, 'data-edicion-pct', '0', '');
    r = reg.revisarEdicion();
    Check('E8b vaciar un % si la marca incompleta (no bloquea)', [true, true, ['pct']],
      [r.listo, r.incompleta, claves(r.faltantes)]);
    editar(p, 'data-edicion-pct', '0', '101');
    r = reg.revisarEdicion();
    Check('E10 % fuera de rango si bloquea', [false, 'error'], [r.listo, /error/.test(p.sel('regEdMsg').className) ? 'error' : '']);
    Check('E11 el registro no cambia (solo el borrador)', ['T PRB 2026-000001', 0.5],
      [reg.registro.buscar('PRB 2026-000001').titulo, reg.registro.buscar('PRB 2026-000001').categorias[0].pct_dism]);

    p.pagina.fijarRol('MOD');
    Check('E12 perder ADM cierra la edicion y quita el boton', [null, true, false],
      [reg.edicion, p.sel('regEdicion').hidden, />Modificar<\/button>/.test(p.sel('regDetAcciones').innerHTML)]);

    var editables = A.EdicionAdmin.campos('editable').map(function (c) { return c.clave; });
    Check('E13 editables propuestos', ['titulo', 'descripcion', 'observaciones', 'pct'], editables);
    Check('E14 codigo y dueños son solo lectura', ['codigo', 'duenos', 'calculados'],
      A.EdicionAdmin.campos('solo_lectura').map(function (c) { return c.clave; }));

    // M) la marca se ve para cualquier rol, en el detalle
    reg.abrirDetalle('PRB 2026-000002');
    var det = p.sel('regDetCuerpo').innerHTML;
    Check('M1 sin categoria: Incompleta solo con Categoria', [true, true, false],
      [/Incompleta/.test(det), /faltan: Categoría\./.test(det), /faltan:[^<]*Observaciones/.test(det)]);
    reg.abrirDetalle('MAP 2026-000003');
    Check('M1b % nulo: Incompleta solo con %, no por la fecha', true,
      /faltan: % Disminución\./.test(p.sel('regDetCuerpo').innerHTML));
    reg.abrirDetalle('PRB 2026-000001');
    Check('M2 completa: sin marca', false, /ini-incompleta"/.test(p.sel('regDetCuerpo').innerHTML));
    Check('M3 la lista no lleva la marca (espera E10)', false, /Incompleta/.test(p.sel('regCuerpo').innerHTML));

    // P) solo los GET de lectura
    Check('P1 solo GET de registro y catalogo', true, p.pedidos.every(function (x) {
      return x.metodo === 'GET' && /admin_iniciativas_(registro|catalogos)\.ashx/.test(x.url);
    }));
  });
});

// VIEWER: admin_sesion dice autorizado:false -> la pagina no muestra nada.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var pg = p.pagina;
    pg.denegar();
    var paneles = ['panel-iniciativas', 'panel-solicitudes', 'panel-nueva', 'panel-crear-admin'];
    Check('VW1 VIEWER: todos los paneles ocultos, pestanas ocultas, aviso visible', [true, true, true, true, true, false],
      paneles.map(function (id) { return p.sel(id).hidden; }).concat([p.sel('iniTabs').hidden, p.sel('iniDenegado').hidden]));
    p.sel('tab-iniciativas').disparar('click');
    p.sel('btnCrearAdmin').disparar('click');
    Check('VW2 navegar no reabre nada', [true, true], [p.sel('panel-iniciativas').hidden, p.sel('panel-crear-admin').hidden]);
    pg.fijarRol('ADM');
    Check('VW3 un rol que llega tarde no revierte la negacion', [null, true], [pg.rol, p.sel('panel-crear-admin').hidden]);
    var html = leer('admin/iniciativas.html');
    Check('VW4 sin autorizar -> denegar(); autorizado -> fijarRol', true,
      /if \(s\.autorizado\) window\.IniciativasPagina\.fijarRol\(s\.rol\);\s*else window\.IniciativasPagina\.denegar\(\);/.test(html));
  });
});

// CB) Boton "+ Crear iniciativa"
pruebas.push(function () {
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  var cab = html.slice(html.indexOf('id="panel-iniciativas"'), html.indexOf('id="regKpis"'));
  Check('CB1 los dos botones en la cabecera de Iniciativas, Solicitar primero', true,
    cab.indexOf('id="btnSolicitar"') > 0 && cab.indexOf('id="btnCrearAdmin"') > cab.indexOf('id="btnSolicitar"'));
  var boton = (/<button[^>]*id="btnCrearAdmin"[\s\S]*?<\/button>/.exec(html) || [''])[0];
  Check('CB1 rotulo "+ Crear iniciativa"', true,
    /<span class="ini-cta-mas" aria-hidden="true">\+<\/span>\s*<span>Crear iniciativa<\/span>/.test(boton));
  Check('CB1 se distingue de Solicitar (linea vs relleno) y dice que es directa', true,
    /class="btn linea ini-cta"/.test(boton) && /title="Creación directa \(ADM\)/.test(boton) &&
    /<button type="button" class="btn ini-cta" id="btnSolicitar"/.test(html));
  var tabs = [], re = /<button[^>]*role="tab"[^>]*id="([^"]+)"[^>]*>([^<]*)<\/button>/g, m;
  while ((m = re.exec(html))) tabs.push(m[1] + ':' + m[2]);
  Check('CB2 siguen exactamente dos pestañas', ['tab-iniciativas:Iniciativas', 'tab-solicitudes:Solicitudes'], tabs);

  // Visibilidad con el SesionAdmin real: solo [data-solo-adm] y rol ADM.
  var ventana = {};
  (new Function('window', leer('assets/js/sesion-admin.js')))(ventana);
  function visibles(respuesta) {
    var solicitar = { id: 'btnSolicitar', hidden: true }, crear = { id: 'btnCrearAdmin', hidden: true };
    // Cada boton en el selector que dice SU atributo en el HTML real.
    var attr = function (id) {
      var tag = (new RegExp('<button[^>]*id="' + id + '"[^>]*>')).exec(html);
      return tag && / data-solo-adm[\s>]/.test(tag[0]) ? '[data-solo-adm]'
        : tag && / data-solo-admin[\s>]/.test(tag[0]) ? '[data-solo-admin]' : '';
    };
    var doc = { querySelectorAll: function (sel) {
      return [solicitar, crear].filter(function (b) { return attr(b.id) === sel; });
    } };
    var pedir = function () { return respuesta === null ? Promise.reject(new Error('red')) : Promise.resolve(respuesta); };
    return new ventana.SesionAdmin('../', pedir).aplicar(doc).then(function () {
      return [solicitar, crear].filter(function (b) { return !b.hidden; }).map(function (b) { return b.id; });
    });
  }
  function r(json) { return { ok: true, json: function () { return Promise.resolve(json); } }; }
  return Promise.all([
    visibles(r({ autorizado: true, rol: 'ADM' })),
    visibles(r({ autorizado: true, rol: 'MOD' })),
    visibles(r({ autorizado: false })),
    visibles(null)
  ]).then(function (v) {
    Check('CB3 ADM ve Solicitar y Crear', ['btnSolicitar', 'btnCrearAdmin'], v[0]);
    Check('CB3 MOD ve Solicitar y no Crear', ['btnSolicitar'], v[1]);
    Check('CB3 VIEWER (no autorizado) no ve ninguno', [], v[2]);
    Check('CB3 sin respuesta de admin_sesion: ninguno', [], v[3]);
  });
});

// CB) Navegacion: los dos borradores sobreviven a Solicitudes y vuelta.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var pg = p.pagina;
    pg.fijarRol('ADM');
    p.sel('btnCrearAdmin').disparar('click');
    elegir(p, 'admTipo', 'PRB');
    escribir(p, 'adm-titulo', 'Borrador directo');
    p.sel('tab-solicitudes').disparar('click');
    Check('CB4 Solicitudes oculta el alta', ['solicitudes', true], [pg.vista, p.sel('panel-crear-admin').hidden]);
    p.sel('btnSolicitar').disparar('click');
    pg.solicitud.elegirTipo('ADO');
    pg.solicitud.capturar('titulo', 'Borrador de solicitud');
    p.sel('tab-iniciativas').disparar('click');
    p.sel('btnCrearAdmin').disparar('click');
    var b = pg.crearAdmin.borrador;
    Check('CB4 al volver, el borrador directo sigue (modelo y control)', ['crear', 'PRB', 'Borrador directo', 'Borrador directo'],
      [pg.vista, b.tipo, b.valores.titulo, p.sel('adm-titulo').value]);
    Check('CB4 el de la solicitud tambien, y son distintos', ['ADO', 'Borrador de solicitud', true],
      [pg.solicitud.tipo, pg.solicitud.valores.titulo, pg.solicitud !== b]);
    var r = pg.crearAdmin.revisar();
    Check('CB5 PRB sin RCA ni otros datos: se puede preparar, queda incompleta con RCA', [true, true, true, false],
      [r.listo, r.incompleta, claves(r.faltantes).indexOf('rca') >= 0, r.guardado]);
    Check('CB5 la solicitud conserva sus reglas (todo obligatorio)', true, pg.solicitud.faltantes().length > 0);
  });
});

// MD) "Modificar" desde el registro: elegir, cargar valores, editar, vista
//     previa en vivo, legado conservado, nada se guarda, solo ADM.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro, pg = p.pagina;
    // Iniciativa con datos heredados: titulo de la iniciativa distinto del
    // del Problem y un % con dos decimales.
    reg.registro.iniciativas.push(Ini('PRB 2026-000009', { titulo: 'Titulo de la iniciativa (Excel)', titulo_problem: 'Titulo del Problem',
      categorias: [Cat('/A/Cat 1', 0.3333)] }));

    pg.fijarRol('MOD');
    Check('MD1 MOD: Modificar no abre ni aparece', [false, null, false],
      [reg.modificar('PRB 2026-000001'), reg.edicion, />Modificar<\/button>/.test(p.sel('regDetAcciones').innerHTML)]);
    pg.fijarRol('ADM');

    Check('MD2 ADM: Modificar abre el detalle con el formulario', [true, 'PRB 2026-000001', false],
      [reg.modificar('PRB 2026-000001'), reg.abierta, p.sel('regEdicion').hidden]);
    var ed = reg.edicion, html = p.sel('regEdicion').innerHTML;
    Check('MD2 valores actuales cargados', ['T PRB 2026-000001', 'Desc PRB 2026-000001', 'Obs PRB 2026-000001', ['50', '25']],
      [ed.valores.titulo, ed.valores.descripcion, ed.valores.observaciones, ed.valores.pct.map(function (x) { return x.valor; })]);
    Check('MD2 ... y pintados en los controles', [true, true, true],
      [/value="T PRB 2026-000001"/.test(html), />Desc PRB 2026-000001<\/textarea>/.test(html), /data-edicion-pct="1" value="25"/.test(html)]);
    Check('MD3 contexto de solo lectura: codigo, tipo y estado', true, /Código PRB 2026-000001 · Problem · En Análisis \(solo lectura\)/.test(html));
    Check('MD3 Guardar deshabilitado y aviso de prototipo + carga del Excel', [true, true],
      [/<button type="button" class="btn chico" disabled/.test(html), /la carga reemplazaría estos campos/.test(html)]);
    Check('MD4 vista previa inicial: sin cambios', true, /Sin cambios\./.test(p.sel('regEdVista').innerHTML));

    editar(p, 'data-edicion', 'titulo', 'Titulo nuevo');
    var vista = p.sel('regEdVista').innerHTML;
    Check('MD4 vista previa en vivo: Titulo actual -> propuesto', true,
      /<th scope="row">Título<\/th><td>T PRB 2026-000001<\/td><td>Titulo nuevo<\/td>/.test(vista));
    editar(p, 'data-edicion-pct', '0', '');
    Check('MD5 vaciar un %: aviso de faltante nuevo en la vista previa', true,
      /Faltaría después del cambio/.test(p.sel('regEdVista').innerHTML) && /% Disminución/.test(p.sel('regEdVista').innerHTML));
    editar(p, 'data-edicion-pct', '0', '150');
    Check('MD5 % fuera de rango: error de formato en la vista previa', true,
      /Escribe un porcentaje entre 0 y 100/.test(p.sel('regEdVista').innerHTML));
    Check('MD6 el registro no cambia', ['T PRB 2026-000001', 0.5],
      [reg.registro.buscar('PRB 2026-000001').titulo_problem, reg.registro.buscar('PRB 2026-000001').categorias[0].pct_dism]);

    // Legado: se conserva tal cual y se avisa.
    reg.modificar('PRB 2026-000009');
    html = p.sel('regEdicion').innerHTML;
    Check('MD7 legado: titulo editable = el del Problem; % 33.33 sin redondeos; sin cambios al abrir',
      ['Titulo del Problem', '33.33', 0], [reg.edicion.valores.titulo, reg.edicion.valores.pct[0].valor, reg.edicion.cambios().length]);
    Check('MD7 aviso: el TituloIniciativa del Excel se conserva', true,
      /ProblemCategoria\.TituloIniciativa: &quot;Titulo de la iniciativa \(Excel\)&quot;/.test(html) || /ProblemCategoria\.TituloIniciativa/.test(html));

    reg.modificar('MAP 2026-000003');
    Check('MD8 faltaba un %: se avisa como previo', true, /Ya faltaba antes de modificar/.test(p.sel('regEdicion').innerHTML));
    editar(p, 'data-edicion-pct', '0', '20');
    Check('MD8 capturarlo: "Se completaría" en la vista previa', true, /Se completaría: % Disminución/.test(p.sel('regEdVista').innerHTML));

    reg.modificar('PRB 2026-000002');
    html = p.sel('regEdicion').innerHTML;
    Check('MD9 sin categoria: dueños del Problem se conservan; sin % que editar; Categoria ya faltaba', [true, true, true],
      [/OwnerProblem, OwnerServicio, Direccion\) y se conservan/.test(html), /Sin categorías: no hay % que editar/.test(html),
       /Incompleta<\/strong> · faltan: Categoría\./.test(html)]);

    p.sel('btnCrearAdmin').disparar('click');
    Check('MD10 ADM: la creacion directa sigue abriendo', 'crear', pg.vista);
    pg.fijarRol('MOD');
    Check('MD10 MOD: la creacion directa no', 'iniciativas', pg.vista);
    Check('MD11 solo lecturas GET, ninguna escritura', true, p.pedidos.every(function (x) { return x.metodo === 'GET'; }));
  });
});

// Sin iniciativa-admin.js la pagina sigue igual (otras paginas o caches viejos).
pruebas.push(function () {
  var p = Pagina(false);
  return esperar().then(function () {
    p.pagina.fijarRol('ADM');
    p.sel('btnCrearAdmin').disparar('click');
    p.registro.abrirDetalle('PRB 2026-000001');
    Check('P2 sin el modulo: ni alta ni edicion, el detalle sigue', ['iniciativas', false, true],
      [p.pagina.vista, />Modificar<\/button>/.test(p.sel('regDetCuerpo').innerHTML), /Solicitar cambios/.test(p.sel('regDetCuerpo').innerHTML)]);
  });
});

pruebas.push(function () {
  var src = leer('admin/iniciativa-admin.js');
  Check('P3 iniciativa-admin.js no llama al servidor', false, /\b(fetch|XMLHttpRequest|sendBeacon)\b|method\s*:/.test(src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  Check('P4 boton de alta ADM oculto hasta rol ADM', true,
    /<button type="button" class="btn linea ini-cta" id="btnCrearAdmin" data-solo-adm hidden[\s>]/.test(html));
  Check('P5 Guardar iniciativa deshabilitado', true, /<button type="button" class="btn" id="admGuardar" disabled/.test(html));
  Check('P6 sin <form> en la pagina', false, /<form\b/.test(html));
  Check('P7 orden: iniciativa-admin.js antes del registro', true,
    /iniciativa-admin\.js[\s\S]*registro-iniciativas\.js[\s\S]*iniciativas\.js"/.test(html));
});

pruebas.reduce(function (cadena, prueba) { return cadena.then(prueba); }, Promise.resolve())
  .then(function () {
    console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
    process.exit(fallos ? 1 : 0);
  }, function (err) {
    console.log('ERROR ' + (err && err.stack || err));
    process.exit(1);
  });
