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
//   R) Camino del problema en Crear: "nuevo" (el formulario de siempre) y
//      "existente" (solo aviso de dependencia: no revisa, no valida, no pide
//      nada). PO / SO ocultos en Crear; Administracion sin alta de
//      categorias ni dueños a la vista.
//   CV) Crear con varias categorias: agregar solo rutas reales, sin
//      repetir; volumetria calculada (ok, cero, sin datos, error) que se
//      refresca al cambiar de categoria; % por categoria.
//   EX) Ligar a un problema existente: busqueda por codigo o nombre,
//      resultados distinguibles, elegir solo uno real, abre su Modificar.
//   ED) Modificar: fechas, Estado/Subestado (de la lista), agregar y quitar
//      categorias, el Codigo nunca viaja como cambio.
//   SL) Selector: <select> hasta 20 opciones, caja con busqueda despues.
//   G) "Validar en el servidor (no guarda)" en Crear y Modificar: 501 es
//      solo validacion (nunca exito); 422, 403, 503, red, 500 y un 501 o
//      200 malformados, cada uno con su mensaje y sin decir "guardado".
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

// Volumetria simulada por ruta (handlers/admin_iniciativas_volumetria.ashx).
var VOLUMETRIAS = {
  '/A/Cat 1': { ruta: '/A/Cat 1', estado: 'ok', volumetria: 418 },
  '/A/Cat 2': { ruta: '/A/Cat 2', estado: 'cero', volumetria: 0 },
  '/B/Cat 4': 'error'
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
    if (/volumetria/.test(url)) {
      var ruta = decodeURIComponent((/ruta=([^&]*)/.exec(url) || [])[1] || '');
      var v = VOLUMETRIAS[ruta];
      if (v === 'error') return Promise.resolve(Respuesta(503, { error: 'error 53', tipo: 'VolumetriaNoDisponible' }));
      return Promise.resolve(Respuesta(200, { slot: 0, rutas: [v || { ruta: ruta, estado: 'cero', volumetria: 0 }] }));
    }
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
  Check('I12 el borrador: la lista completa, sin Volumetria (es calculada)', ['categoria', 'titulo', 'descripcion', 'observaciones', 'pct', 'rca'],
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
  Check('B5 ... y queda incompleta, con RCA entre los faltantes (sin categorias el % no se pide aparte)',
    [true, ['categoria', 'titulo', 'descripcion', 'observaciones', 'rca']], [r.incompleta, claves(r.faltantes)]);
  Check('B6 nunca codigo ni guardado; siempre el aviso de prototipo', [null, false, true],
    [r.codigo, r.guardado, /No se guardó nada/.test(r.aviso)]);

  b.elegirTipo('ADO');
  Check('B7 otro tipo sin RCA: el RCA no falta', false, claves(b.faltantes()).indexOf('rca') >= 0);

  Check('B8 la categoria se agrega sin PO ni SO (todo opcional)', [true, ['/B/Cat 4']],
    [b.agregarCategoria('/B/Cat 4').ok, b.categorias.activas().map(function (f) { return f.categoria; })]);
  Check('B9 categoria fuera del catalogo no se acepta', [false, 1], [b.agregarCategoria('/Inventada').ok, b.categorias.filas.length]);

  b.categorias.capturarPct(0, '150');
  r = b.revisar();
  Check('B10 % invalido si bloquea', [false, ['pct']], [r.listo, claves(r.formato)]);

  b.elegirTipo('PRB');
  b.categorias.quitar(0);
  b.agregarCategoria('/A/Cat 1');
  ['titulo', 'descripcion', 'observaciones'].forEach(function (k) { b.capturar(k, 'x'); });
  b.categorias.capturarPct(0, '25.5');
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
    Check('C2 selector de categoria con las rutas (3 <= 20: select normal)', [false, true, 3],
      [p.sel('admCatAgregar').disabled, /<select id="admCatBuscar"/.test(p.sel('admCatSelector').innerHTML),
       (p.sel('admCatSelector').innerHTML.match(/<option value="\//g) || []).length]);
    elegir(p, 'admTipo', 'PRB');
    Check('C3 aviso en vivo: incompleta, con RCA', true,
      /Incompleta/.test(p.sel('admFaltantes').innerHTML) && /RCA/.test(p.sel('admFaltantes').innerHTML));
    Check('C4 nota RCA de Problem: no bloquea', true, /sin RCA queda incompleta/.test(p.sel('admRcaNota').textContent));
    escribir(p, 'adm-titulo', 'Caída de X');
    Check('C5 escribir quita el faltante', false, /Título/.test(p.sel('admFaltantes').innerHTML));
    p.pagina.crearAdmin.agregarCategoria('/B/Cat 4');
    Check('C6 Director derivado de la categoria', 'Dir B', p.sel('admDirector').textContent);
    p.sel('admRevisar').disparar('click');
    var res = p.sel('admResultado');
    Check('C7 Revisar: "no guardado" + aviso de prototipo, nunca clase ok', [false, true, true, false],
      [res.hidden, /no guardado/.test(res.innerHTML), /No se guardó nada/.test(res.innerHTML), res.classList.contains('ok')]);
    Check('C8 el codigo no se inventa', 'Sin código: no se asigna todavía (regla pendiente)',
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
    Check('E5 abre el formulario: aviso de persistencia no habilitada y Guardar que valida en el servidor', [false, true, true],
      [p.sel('regEdicion').hidden, /la persistencia no está habilitada/.test(html), /data-accion="edicion-guardar"/.test(html)]);
    Check('E5b el boton dice que solo valida; ningun boton "Guardar" a secas', [true, false],
      [/data-accion="edicion-guardar"[^>]*>Validar en el servidor \(no guarda\)<\/button>/.test(html),
       /<button[^>]*>\s*Guardar\s*<\/button>/.test(html)]);
    Check('E6 lista lo que no es editable, con motivo (RCA pendiente; codigo y dueños solo lectura)', true,
      /<b>RCA<\/b> · pendiente de contrato/.test(html) && /<b>Código y Tipo de iniciativa<\/b> · solo lectura/.test(html));
    Check('E6b fechas, Estado y categorias ya son editables', [true, true, true],
      [/type="date" id="regEd-f_analisis" data-edicion="f_analisis" value="2026-12-01"/.test(html),
       /Estado<\/span><p class="ini-nota">En Análisis · sin lista de valores: no se puede cambiar\./.test(html), /id="regEdCats"/.test(html)]);

    editar(p, 'data-edicion', 'titulo', 'Nuevo titulo');
    editar(p, 'data-edicion', 'descripcion', '');
    editar(p, 'data-edicion-pct', '1', '30');
    var r = reg.revisarEdicion();
    Check('E7 cambios detectados', ['titulo', 'descripcion', 'pct'], claves(r.cambios));
    Check('E8 vaciar Descripcion NO marca incompleta a una existente', [true, false, []],
      [r.listo, r.incompleta, claves(r.faltantes)]);
    Check('E9 nunca guardado; el mensaje lo dice', [false, true],
      [r.guardado, /no guardados/.test(p.sel('regEdMsg').innerHTML) && /No se guardó nada/.test(p.sel('regEdMsg').innerHTML)]);
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
    Check('E13 editables propuestos', ['titulo', 'descripcion', 'observaciones', 'f_analisis', 'f_solucion', 'f_cierre',
      'estado', 'subestado', 'categorias'], editables);
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
    Check('P1 solo GET de registro, catalogo y volumetria', true, p.pedidos.every(function (x) {
      return x.metodo === 'GET' && /admin_iniciativas_(registro|catalogos|volumetria)\.ashx/.test(x.url);
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
  var adm = html.slice(html.indexOf('id="panel-administracion"'), html.indexOf('id="panel-nueva"'));
  Check('CB1 Solicitar en la cabecera de Iniciativas; Crear en Administracion, no en Iniciativas', true,
    cab.indexOf('id="btnSolicitar"') > 0 && cab.indexOf('id="btnCrearAdmin"') < 0 && adm.indexOf('id="btnCrearAdmin"') > 0);
  var boton = (/<button[^>]*id="btnCrearAdmin"[\s\S]*?<\/button>/.exec(html) || [''])[0];
  Check('CB1 rotulo "+ Crear iniciativa"', true,
    /<span class="ini-cta-mas" aria-hidden="true">\+<\/span>\s*<span>Crear iniciativa<\/span>/.test(boton));
  Check('CB1 dice que es directa (vive en otra pestaña que Solicitar)', true,
    /title="Creación directa \(ADM\)/.test(boton) &&
    /<button type="button" class="btn ini-cta" id="btnSolicitar"/.test(html));
  var tabs = [], re = /<button[^>]*role="tab"[^>]*id="([^"]+)"[^>]*>([^<]*)<\/button>/g, m;
  while ((m = re.exec(html))) tabs.push(m[1] + ':' + m[2]);
  Check('CB2 tres pestañas: Iniciativas | Solicitudes | Administracion', ['tab-iniciativas:Iniciativas', 'tab-solicitudes:Solicitudes', 'tab-administracion:Administración'], tabs);
  Check('CB2 Administracion oculta hasta rol ADM', true,
    /<button[^>]*id="tab-administracion"[^>]*data-solo-adm hidden>/.test(html));

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
    Check('MD3 Guardar valida en el servidor; aviso de persistencia + carga del Excel', [true, true],
      [/data-accion="edicion-guardar"/.test(html), /la carga reemplazaría estos campos/.test(html)]);
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
    Check('MD9 sin categoria: dueños del Problem se conservan; sin categorias todavia; Categoria ya faltaba', [true, true, true],
      [/OwnerProblem, OwnerServicio, Direccion\) y se conservan/.test(html), /Sin categorías todavía/.test(html),
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
  var codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  Check('P3 iniciativa-admin.js solo habla con gestion (POST) y volumetria (GET)',
    [2, ['\'../handlers/admin_iniciativas_gestion.ashx\'', '\'../handlers/admin_iniciativas_volumetria.ashx\''],
     ["method: 'GET'", "method: 'POST'"], false],
    [(codigo.match(/\bfetch\(/g) || []).length, codigo.match(/'\.\.\/handlers\/[^']+'/g), codigo.match(/method: '[A-Z]+'/g),
     /XMLHttpRequest|sendBeacon/.test(codigo)]);
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  Check('P4 boton de alta ADM oculto hasta rol ADM', true,
    /<button type="button" class="btn ini-cta" id="btnCrearAdmin" data-solo-adm hidden[\s>]/.test(html));
  Check('P5 Guardar iniciativa habilitado (valida en el servidor) y dice que no guarda', [true, true],
    [/<button type="button" class="btn" id="admGuardar" aria-describedby/.test(html), /no guarda mientras la persistencia no esté habilitada/.test(html)]);
  Check('P5b el boton de Crear se llama "Validar en el servidor (no guarda)"; sin "Guardar iniciativa"', [true, false],
    [/id="admGuardar"[^>]*>Validar en el servidor \(no guarda\)<\/button>/.test(html), /Guardar iniciativa/.test(html)]);
  Check('P6 sin <form> en la pagina', false, /<form\b/.test(html));
  Check('P7 orden: iniciativa-admin.js antes del registro', true,
    /iniciativa-admin\.js[\s\S]*registro-iniciativas\.js[\s\S]*iniciativas\.js"/.test(html));
});

// T) Pestaña Administracion: solo ADM; Crear cuelga de ella.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var pg = p.pagina, tab = p.sel('tab-administracion');
    Check('T1 sin rol: pestaña oculta y no abre', [true, 'iniciativas', true],
      [tab.hidden, (pg.mostrarVista('administracion'), pg.vista), p.sel('panel-administracion').hidden]);
    pg.fijarRol('MOD');
    tab.disparar('click');
    Check('T2 MOD: pestaña oculta y el clic no abre', [true, 'iniciativas'], [tab.hidden, pg.vista]);
    p.sel('tab-solicitudes').disparar('keydown', { key: 'ArrowRight' });
    Check('T3 MOD: la flecha salta la pestaña oculta', 'iniciativas', pg.vista);
    pg.fijarRol('ADM');
    tab.disparar('click');
    Check('T4 ADM: pestaña visible y abre su panel', [false, 'administracion', false, true],
      [tab.hidden, pg.vista, p.sel('panel-administracion').hidden, p.sel('panel-iniciativas').hidden]);
    p.sel('btnCrearAdmin').disparar('click');
    Check('T5 Crear se abre desde Administracion y marca su pestaña', ['crear', true],
      [pg.vista, tab.classList.contains('activa')]);
    p.sel('btnVolverAdmin').disparar('click');
    Check('T6 Volver regresa a Administracion', 'administracion', pg.vista);
    pg.fijarRol('MOD');
    Check('T7 perder ADM en Administracion vuelve a Iniciativas y oculta la pestaña', ['iniciativas', true, true],
      [pg.vista, tab.hidden, p.sel('panel-administracion').hidden]);
  });
});

// D) El aviso de acceso denegado se oculta de verdad: .ini-vacio pone
// display:flex, que le ganaria al atributo hidden (se veia con rol ADM).
pruebas.push(function () {
  var css = leer('admin/iniciativas.css').replace(/\/\*[\s\S]*?\*\//g, '');
  var html = leer('admin/iniciativas.html');
  Check('D1 #iniDenegado es .ini-vacio y arranca oculto', true,
    /<div class="ini-vacio" id="iniDenegado" role="alert" hidden>/.test(html));
  Check('D2 .ini-vacio[hidden] { display: none }', true, /\.ini-vacio\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(css));
  // Toda clase con display propio que se usa con hidden fuera de un panel.
  var fuera = html.replace(/<!--[\s\S]*?-->/g, '').match(/<[a-z]+ class="(ini-[a-z-]+)"[^>]*\shidden[\s>]/g) || [];
  var sinRegla = fuera.map(function (t) { return /class="(ini-[a-z-]+)"/.exec(t)[1]; }).filter(function (c, i, a) {
    var conDisplay = new RegExp('\.' + c + '\s*\{[^}]*display:').test(css);
    var oculta = new RegExp('\.' + c + '\[hidden\]').test(css);
    return a.indexOf(c) === i && conDisplay && !oculta;
  });
  Check('D3 ninguna clase con display propio pierde el hidden', [], sinRegla);
});

// R) Camino del problema + PO/SO ocultos + Administracion sin alta ni dueños
pruebas.push(function () {
  var html = leer('admin/iniciativas.html');
  var sinCom = html.replace(/<!--[\s\S]*?-->/g, '');
  var crear = sinCom.slice(sinCom.indexOf('id="panel-crear-admin"'), sinCom.indexOf('id="regDetFondo"'));
  Check('R1 PO y SO ya no se eligen en Crear (viajan vacios)', [false, false], [/id="admPo"/.test(crear), /id="admSo"/.test(crear)]);
  Check('R1 Categorias de Crear: selector, agregar y tabla', [true, true, true],
    [/id="admCatSelector"/.test(crear), /id="admCatAgregar"/.test(crear), /id="admCats"/.test(crear)]);
  Check('R2 dos caminos; "nuevo" marcado por omision', [true, true, true],
    [/<input type="radio" name="admRuta" id="admRutaNuevo" value="nuevo" checked>/.test(crear),
     /<input type="radio" name="admRuta" id="admRutaExistente" value="existente">/.test(crear),
     /id="admExistente" hidden>/.test(crear)]);
  Check('R2 el camino "nuevo" conserva sus campos; la volumetria ya no se captura', [true, false],
    [['admTipo', 'admCatSelector', 'adm-titulo', 'adm-descripcion', 'adm-observaciones', 'admRca']
      .every(function (id) { return crear.indexOf('id="' + id + '"') > 0; }), /id="adm-volumetria"|id="adm-pct"/.test(crear)]);
  Check('R2 "existente": buscador y lista', true,
    ['admExistenteBuscar', 'admExistenteLista']
      .every(function (id) { return crear.indexOf('id="' + id + '"') > 0; }));
  var adm = sinCom.slice(sinCom.indexOf('id="panel-administracion"'), sinCom.indexOf('id="panel-nueva"'));
  Check('R3 Administracion: sin alta de categorias; dueños nace oculta', [false, false, true],
    [/caSeccion|caValidar|Alta de categor/.test(adm), /categorias-alta\.js/.test(sinCom),
     /id="cdSeccion" aria-labelledby="cdTitulo" hidden>/.test(adm)]);
  var css = leer('admin/iniciativas.css');
  Check('R3 hidden le gana al display de .ini-campo y .ini-form', true,
    /\.ini-campo\[hidden\], \.ini-form\[hidden\] \{ display: none; \}/.test(css));

  var p = Pagina();
  return esperar().then(function () {
    var pg = p.pagina, v = pg.crearAdmin;
    pg.fijarRol('ADM');
    pg.mostrarVista('administracion');
    Check('R4 abrir Administracion: dueños oculto, sin pedir ?duenos=1', [true, false],
      [p.sel('cdSeccion').hidden, p.pedidos.some(function (x) { return /duenos=1/.test(x.url); })]);
    pg.mostrarVista('crear');
    Check('R5 por omision "nuevo": formulario a la vista, buscador oculto, botones activos', ['nuevo', false, true, false, false],
      [v.ruta, p.sel('admForm').hidden, p.sel('admExistente').hidden, p.sel('admRevisar').disabled, p.sel('admGuardar').disabled]);
    elegir(p, 'admTipo', 'ADO');
    escribir(p, 'adm-titulo', 'Borrador que no se pierde');
    var antes = p.pedidos.length;
    var r = p.sel('admRutaExistente');
    r.value = 'existente'; r.checked = true; r.disparar('change');
    Check('R6 "existente": buscador visible, formulario y faltantes ocultos, botones apagados', ['existente', true, false, true, true, true],
      [v.ruta, p.sel('admForm').hidden, p.sel('admExistente').hidden, p.sel('admFaltantes').hidden,
       p.sel('admRevisar').disabled, p.sel('admGuardar').disabled]);
    Check('R7 "existente": revisar no hace nada', null, v.revisar());
    return v.guardar().then(function (g) {
      Check('R7 "existente": guardar no envia nada', [null, antes], [g, p.pedidos.length]);
      Check('R8 elegirRuta rechaza valores desconocidos', [false, 'existente'], [v.elegirRuta('otro'), v.ruta]);
      var n = p.sel('admRutaNuevo');
      n.value = 'nuevo'; n.checked = true; n.disparar('change');
      Check('R9 volver a "nuevo" conserva el borrador y reactiva', ['nuevo', 'ADO', 'Borrador que no se pierde', false, false],
        [v.ruta, v.borrador.tipo, v.borrador.valores.titulo, p.sel('admForm').hidden, p.sel('admRevisar').disabled]);
      Check('R10 lo que viaja sigue mandando po/so vacios (opcionales en el servidor)', [['po', ''], ['so', '']],
        v.borrador.paraEnviar().filter(function (x) { return x[0] === 'po' || x[0] === 'so'; }));
      Check('R11 RUTAS_PROBLEMA exportado', ['nuevo', 'existente'], A.RUTAS_PROBLEMA);
    });
  });
});

// G) Guardar = validar en el servidor (admin_iniciativas_gestion.ashx). Nunca exito.
function RespuestaHttp(estado, json) {
  return { status: estado, ok: estado >= 200 && estado < 300,
    json: function () { return json === undefined ? Promise.reject(new Error('no json')) : Promise.resolve(json); } };
}
function Servidor(estado, json) {
  var s = { pedidos: [], pedir: function (url, op) {
    var campos = [];
    if (op && op.body && op.body.forEach) op.body.forEach(function (v, k) { campos.push([k, typeof v === 'string' ? v : '(archivo)']); });
    s.pedidos.push({ url: url, metodo: op && op.method, campos: campos });
    return estado === 0 ? Promise.reject(new Error('red')) : Promise.resolve(RespuestaHttp(estado, json));
  } };
  return s;
}
var NO_HABILITADA = { valida: true, guardada: false, tipo: 'PersistenciaNoHabilitada', persistencia: 'no_habilitada',
  persistencia_motivo: 'Persistencia no habilitada: la validación pasó, pero no se guardó nada.', errores: [], advertencias: ['aviso X'],
  cambios: [{ clave: 'titulo', rotulo: 'Título', anterior: 'T PRB 2026-000001', nuevo: 'Nuevo' }], faltantes: [], bloqueos: ['b1'] };

pruebas.push(function () {
  var R = base.ventana.IniciativaAdmin.RespuestaGestion;
  Check('G1 estados de la respuesta', ['no_habilitada', 'invalida', 'denegado', 'no_disponible', 'error', 'error', 'error'], [
    R.desde(501, NO_HABILITADA).estado,
    R.desde(422, { valida: false, errores: [{ campo: 'tipo', mensaje: 'm' }] }).estado,
    R.desde(403, { tipo: 'RolInsuficiente' }).estado,
    R.desde(503, { tipo: 'ValidacionNoDisponible' }).estado,
    R.desde(500, { error: 'x' }).estado,
    R.desde(0, null).estado,
    // un 200 (o cualquier cosa que dijera guardada) NO es no_habilitada ni exito
    R.desde(200, { valida: true, guardada: true }).estado
  ]);
  Check('G1 501 con guardada:true no se acepta', 'error',
    R.desde(501, { valida: true, guardada: true, tipo: 'PersistenciaNoHabilitada' }).estado);
  Check('G2 nunca guardada', true, [501, 422, 403, 503, 500, 0, 200].every(function (e) { return R.desde(e, NO_HABILITADA).guardada === false; }));
});

pruebas.push(function () {
  var p = Pagina(), srv;
  return esperar().then(function () {
    var reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.modificar('PRB 2026-000001');
    srv = Servidor(501, NO_HABILITADA);
    return reg.guardarEdicion(srv.pedir).then(function (r) {
      Check('G3 sin cambios no se envia', [null, 0, true], [r, srv.pedidos.length, /Sin cambios/.test(p.sel('regEdMsg').innerHTML)]);
      editar(p, 'data-edicion-pct', '0', '150');
      return reg.guardarEdicion(srv.pedir);
    }).then(function (r) {
      Check('G4 error de formato local no se envia', [null, 0], [r, srv.pedidos.length]);
      editar(p, 'data-edicion-pct', '0', '50');
      editar(p, 'data-edicion', 'titulo', 'Nuevo');
      return reg.guardarEdicion(srv.pedir);
    }).then(function (r) {
      var msg = p.sel('regEdMsg');
      Check('G5 envia POST solo lo cambiado', ['../handlers/admin_iniciativas_gestion.ashx', 'POST',
        [['accion', 'modificar'], ['folio', 'PRB 2026-000001'], ['titulo', 'Nuevo']]],
        [srv.pedidos[0].url, srv.pedidos[0].metodo, srv.pedidos[0].campos]);
      Check('G6 501: "validado, no se guardó", clase aviso, nunca exito', ['no_habilitada', true, true, false, true],
        [r.estado, /No se guardó: la persistencia no está habilitada/.test(msg.innerHTML), msg.className.indexOf('aviso') >= 0,
         /con éxito|Guardado\b|Guardada\b/.test(msg.innerHTML), /aviso X/.test(msg.innerHTML)]);
      Check('G6b 501: el titulo empieza por "Solo validación"', true,
        /<strong class="ini-prototipo-marca">Solo validación:/.test(msg.innerHTML));
      srv = Servidor(422, { valida: false, tipo: 'ValidacionFallida', errores: [{ campo: 'pct', mensaje: '/X: no está ligada' }] });
      return reg.guardarEdicion(srv.pedir);
    }).then(function (r) {
      var msg = p.sel('regEdMsg');
      Check('G7 422: errores del servidor, clase error, sin hablar de persistencia', ['invalida', true, true, true, false],
        [r.estado, /El servidor rechazó/.test(msg.innerHTML), /no está ligada/.test(msg.innerHTML),
         msg.className.indexOf('error') >= 0, /persistencia no está habilitada/.test(msg.innerHTML)]);
      return reg.guardarEdicion(Servidor(403, { error: 'Solo ADM', tipo: 'RolInsuficiente' }).pedir);
    }).then(function (r) {
      Check('G8 403: sin permiso', ['denegado', true], [r.estado, /Sin permiso/.test(p.sel('regEdMsg').innerHTML)]);
      Check('G8b 403: dice que no se validó ni guardó, clase error, sin "Solo validación"', [true, true, false],
        [/No se validó ni se guardó nada/.test(p.sel('regEdMsg').innerHTML), p.sel('regEdMsg').className.indexOf('error') >= 0,
         /Solo validación/.test(p.sel('regEdMsg').innerHTML)]);
      return reg.guardarEdicion(Servidor(503, { error: 'error 53', tipo: 'ValidacionNoDisponible' }).pedir);
    }).then(function (r) {
      Check('G9 503: no se pudo validar (no dice validado)', ['no_disponible', true, false],
        [r.estado, /No se pudo validar en el servidor/.test(p.sel('regEdMsg').innerHTML),
         /Validado en el servidor/.test(p.sel('regEdMsg').innerHTML)]);
      return reg.guardarEdicion(Servidor(0).pedir);
    }).then(function (r) {
      Check('G10 red caida: error, no se guardo', ['error', true], [r.estado, /No se guardó nada/.test(p.sel('regEdMsg').innerHTML)]);
      Check('G10b red caida: dice que no hubo contacto con el servidor', true,
        /No se pudo contactar al servidor/.test(p.sel('regEdMsg').innerHTML));
      p.pagina.fijarRol('MOD');
      srv = Servidor(501, NO_HABILITADA);
      return reg.guardarEdicion(srv.pedir);
    }).then(function (r) {
      Check('G11 MOD: ni se envia', [null, 0], [r, srv.pedidos.length]);
    });
  });
});

pruebas.push(function () {
  var p = Pagina(), srv;
  return esperar().then(function () {
    var pg = p.pagina;
    pg.fijarRol('ADM');
    p.sel('tab-administracion').disparar('click');
    p.sel('btnCrearAdmin').disparar('click');
    srv = Servidor(501, { valida: true, guardada: false, tipo: 'PersistenciaNoHabilitada', persistencia_motivo: 'no habilitada',
      errores: [], advertencias: [], cambios: [], faltantes: [{ clave: 'titulo', rotulo: 'Título' }] });
    pg.crearAdmin.pedir = srv.pedir;
    return pg.crearAdmin.guardar();
  }).then(function (r) {
    Check('G12 sin tipo: no se envia (bloqueante local)', [null, 0], [r, srv.pedidos.length]);
    elegir(p, 'admTipo', 'ADO');
    p.pagina.crearAdmin.agregarCategoria('/A/Cat 2');
    p.pagina.crearAdmin.agregarCategoria('/A/Cat 1');
    p.pagina.crearAdmin.borrador.categorias.capturarPct(0, '15');
    return p.pagina.crearAdmin.guardar();
  }).then(function (r) {
    var caja = p.sel('admResultado'), campos = {};
    srv.pedidos[0].campos.forEach(function (c) { campos[c[0]] = c[1]; });
    Check('G13 envia accion=crear con dos categorias y su %', ['crear', 'ADO', '', [['cat_ruta', '/A/Cat 2'], ['cat_pct', '15'], ['cat_ruta', '/A/Cat 1'], ['cat_pct', '']]],
      [campos.accion, campos.tipo, campos.po, srv.pedidos[0].campos.filter(function (c) { return /^cat_/.test(c[0]); })]);
    Check('G13 la volumetria no viaja (es calculada)', false, srv.pedidos[0].campos.some(function (c) { return /volumetria/.test(c[0]); }));
    Check('G14 501: aviso, faltantes del servidor, nunca ok', ['no_habilitada', true, false, true, true],
      [r.estado, caja.classList.contains('aviso'), caja.classList.contains('ok'), /Incompleta/.test(caja.innerHTML), /No se guardó/.test(caja.innerHTML)]);
    Check('G15 Guardar se reactiva', false, p.sel('admGuardar').disabled);
  });
});

// G16-G23) Crear: cada estado HTTP con su mensaje, siempre "no se guardó" y
// nunca la clase ok ni un texto de exito.
pruebas.push(function () {
  var p = Pagina(), caja;
  var exito = /con éxito|Guardado\b|Guardada\b|Iniciativa creada/;
  function validar(estado, json) {
    p.pagina.crearAdmin.pedir = Servidor(estado, json).pedir;
    return p.pagina.crearAdmin.guardar();
  }
  return esperar().then(function () {
    var pg = p.pagina;
    pg.fijarRol('ADM');
    p.sel('tab-administracion').disparar('click');
    p.sel('btnCrearAdmin').disparar('click');
    elegir(p, 'admTipo', 'ADO');
    caja = p.sel('admResultado');
    return validar(501, NO_HABILITADA);
  }).then(function (r) {
    Check('G16 Crear 501: Solo validación, no se guardó, aviso, nunca ok ni exito', ['no_habilitada', true, true, true, false, false],
      [r.estado, /Solo validación/.test(caja.innerHTML), /NO se guardó nada/.test(caja.innerHTML), caja.classList.contains('aviso'),
       caja.classList.contains('ok'), exito.test(caja.innerHTML)]);
    return validar(422, { valida: false, tipo: 'ValidacionFallida', errores: [{ campo: 'tipo', mensaje: 'Tipo X no existe.' }] });
  }).then(function (r) {
    Check('G17 Crear 422: errores del servidor, "no se guardó", clase mal, sin "Solo validación"', ['invalida', true, true, true, false],
      [r.estado, /Tipo X no existe/.test(caja.innerHTML), /no se guardó nada/.test(caja.innerHTML), caja.classList.contains('mal'),
       /Solo validación/.test(caja.innerHTML)]);
    return validar(422, { valida: false, tipo: 'ValidacionFallida', error: 'Formato no válido.', errores: [] });
  }).then(function (r) {
    Check('G18 Crear 422 sin lista de errores: muestra el mensaje del servidor', ['invalida', true],
      [r.estado, /Formato no válido\./.test(caja.innerHTML)]);
    return validar(403, { error: 'Solo un administrador (ADM) puede crear o modificar iniciativas directamente.', tipo: 'RolInsuficiente' });
  }).then(function (r) {
    Check('G19 Crear 403: sin permiso, no se validó ni guardó, clase mal', ['denegado', true, true, true],
      [r.estado, /Sin permiso/.test(caja.innerHTML), /No se validó ni se guardó nada/.test(caja.innerHTML), caja.classList.contains('mal')]);
    return validar(503, { error: 'No se pudo leer el catálogo.', tipo: 'ValidacionNoDisponible' });
  }).then(function (r) {
    Check('G20 Crear 503: no se pudo validar, no dice válido, clase mal', ['no_disponible', true, false, true],
      [r.estado, /No se pudo validar en el servidor/.test(caja.innerHTML), /Solo validación|son válidos/.test(caja.innerHTML),
       caja.classList.contains('mal')]);
    return validar(0);
  }).then(function (r) {
    Check('G21 Crear red caida: no hubo contacto, no se guardó, boton reactivado', ['error', true, true, false],
      [r.estado, /No se pudo contactar al servidor/.test(caja.innerHTML), /No se guardó nada/.test(caja.innerHTML),
       p.sel('admGuardar').disabled]);
    return validar(501, { valida: true, guardada: false, error: 'Not Implemented' });
  }).then(function (r) {
    Check('G22 Crear 501 sin tipo PersistenciaNoHabilitada: error, nunca "Solo validación"', ['error', false, true],
      [r.estado, /Solo validación/.test(caja.innerHTML), /No se guardó nada/.test(caja.innerHTML)]);
    return validar(200, { valida: true, guardada: true });
  }).then(function (r) {
    Check('G23 Crear 200 "guardada": no se acepta como exito', ['error', false, false, false],
      [r.estado, r.guardada, caja.classList.contains('ok'), exito.test(caja.innerHTML)]);
  });
});

// SL) Selector
pruebas.push(function () {
  var S = A.Selector, veinte = [], veintiuna = [];
  for (var n = 1; n <= 21; n++) { if (n <= 20) veinte.push('/R/' + n); veintiuna.push('/R/' + n); }
  Check('SL1 hasta 20 opciones: select', [true, false], [/^<select id="x"/.test(S.html('x', veinte, '')), /datalist/.test(S.html('x', veinte, ''))]);
  Check('SL2 21 opciones: caja con busqueda (input list + datalist)', [true, true],
    [/^<input type="text" id="x" list="x-lista"/.test(S.html('x', veintiuna, '')), /<datalist id="x-lista">/.test(S.html('x', veintiuna, ''))]);
  Check('SL3 resolver: solo una opcion real, sin mayusculas ni espacios de mas', ['/R/3', '', ''],
    [S.resolver('  /r/3 ', veintiuna), S.resolver('/R/', veintiuna), S.resolver('', veintiuna)]);
  Check('SL4 escapa valores', true, /value="\/A&quot;B"/.test(S.html('x', ['/A"B'], '')));
});

// CV) Crear con varias categorias + volumetria
pruebas.push(function () {
  var p = Pagina(), v;
  return esperar().then(function () {
    var pg = p.pagina;
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    v = pg.crearAdmin;
    elegir(p, 'admTipo', 'ADO');
    var cats = v.borrador.categorias;
    Check('CV1 escribir algo que no es categoria no agrega nada', [false, 0, true],
      [v.agregarCategoria('/A/Cat').ok, cats.filas.length, /no es una categoría vigente/.test(p.sel('admCatMsg').textContent)]);
    Check('CV2 agregar una real (sin distinguir mayusculas): toma la ruta del catalogo', [true, '/A/Cat 1'],
      [v.agregarCategoria('/a/cat 1').ok, cats.filas[0].categoria]);
    Check('CV3 agregarla otra vez se rechaza (duplicado)', [false, 1, true],
      [v.agregarCategoria('/A/Cat 1').ok, cats.filas.length, /ya está en la lista/.test(p.sel('admCatMsg').textContent)]);
    Check('CV4 al agregar: consultando…', true, /Consultando…/.test(p.sel('admCats').innerHTML));
    v.agregarCategoria('/A/Cat 2');
    v.agregarCategoria('/B/Cat 4');
    return esperar().then(esperar);
  }).then(function () {
    var html = p.sel('admCats').innerHTML;
    Check('CV5 volumetria: ok, cero real y error (nunca 0 si fallo)', [true, true, true, false],
      [/418 tickets \(últimos 30 días\)/.test(html), /0 tickets en los últimos 30 días/.test(html),
       /No se pudo consultar: error 53/.test(html), /ini-vol mal[^<]*>0 tickets/.test(html)]);
    Check('CV6 la volumetria es de solo lectura (output, sin input)', [true, false],
      [/<output class="ini-vol/.test(html), /data-crear-vol|name="volumetria"/.test(html)]);
    Check('CV6 % editable por categoria', 3, (html.match(/data-crear-pct="/g) || []).length);
    Check('CV7 directores distintos: no se adivina', '—', p.sel('admDirector').textContent);
    // cambiar de categoria: quitar /B/Cat 4 y poner otra refresca la tabla
    var b = Elemento('b'); b.setAttribute('data-crear-cat', 'quitar'); b.setAttribute('data-indice', '2');
    p.sel('admCats').disparar('click', { target: b });
    Check('CV8 quitar una nueva la descarta y refresca', [2, false, 'Dir A'],
      [v.borrador.categorias.filas.length, /error 53/.test(p.sel('admCats').innerHTML), p.sel('admDirector').textContent]);
    var t = Elemento('t'); t.setAttribute('data-crear-pct', '0'); t.value = '40';
    p.sel('admCats').disparar('input', { target: t });
    Check('CV9 % por categoria en el modelo', ['40', ''], v.borrador.categorias.filas.map(function (f) { return f.valor; }));
    Check('CV10 una sin %: Incompleta por %', true, /% Disminución/.test(p.sel('admFaltantes').innerHTML));
    var vol = new A.VolumetriaCliente(function () { return Promise.resolve(Respuesta(200, { rutas: [{ estado: 'sin_datos', volumetria: null }] })); });
    return vol.consultar('/X').then(function (e) {
      Check('CV11 sin datos: se dice, no es 0', ['sin_datos', null, true],
        [e.estado, e.valor, /Sin datos de tickets/.test(A.VolumetriaCliente.texto(e))]);
      var caida = new A.VolumetriaCliente(function () { return Promise.reject(new Error('red')); });
      return caida.consultar('/X');
    }).then(function (e) {
      Check('CV12 red caida: error, y se puede reintentar', ['error', null], [e.estado, e.valor]);
    });
  });
});

// EX) Ligar a un problema existente
pruebas.push(function () {
  var p = Pagina(), v, elegidos = [];
  return esperar().then(function () {
    var pg = p.pagina;
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    v = pg.crearAdmin;
    var r = p.sel('admRutaExistente');
    r.value = 'existente'; r.checked = true; r.disparar('change');
    Check('EX1 sin texto: pide escribir', true, /Escribe parte del código o del nombre/.test(p.sel('admExistenteLista').innerHTML));
    escribir(p, 'admExistenteBuscar', '2026-00000');
    var html = p.sel('admExistenteLista').innerHTML;
    Check('EX2 busca por codigo parcial', [true, true, true],
      [/data-existente="PRB 2026-000001"/.test(html), /data-existente="PRB 2026-000002"/.test(html), /data-existente="MAP 2026-000003"/.test(html)]);
    escribir(p, 'admExistenteBuscar', 'map-2026-3');
    html = p.sel('admExistenteLista').innerHTML;
    Check('EX3 separadores y ceros no importan; muestra estado y categorias para distinguir', [1, true, true],
      [(html.match(/data-existente=/g) || []).length, /En Solución/.test(html), /1 categoría/.test(html)]);
    escribir(p, 'admExistenteBuscar', 't prb 2026-000002');
    Check('EX4 por nombre (parcial)', true, /data-existente="PRB 2026-000002"/.test(p.sel('admExistenteLista').innerHTML));
    escribir(p, 'admExistenteBuscar', 'no existe nada asi');
    Check('EX5 sin coincidencias: lo dice y no crea nada', true, /No hay problemas que coincidan/.test(p.sel('admExistenteLista').innerHTML));
    Check('EX6 un folio escrito a mano que no esta en el registro no se elige', false, v.elegirExistente('PRB 2099-000001'));
    var b = Elemento('b'); b.setAttribute('data-existente', 'PRB 2026-000001');
    p.sel('admExistenteLista').disparar('click', { target: b });
    var reg = p.registro;
    Check('EX7 elegir uno real abre su Modificar en Iniciativas, con sus categorias y %', ['iniciativas', 'PRB 2026-000001', ['50', '25']],
      [pg.vista, reg.abierta, reg.edicion.categorias.filas.map(function (f) { return f.valor; })]);
    Check('EX8 el codigo no cambia: solo identifica', 'PRB 2026-000001', reg.edicion.paraEnviar()[1][1]);
    elegidos.push(1);
  });
});

// ED) Modificar: fechas, Estado, categorias
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro, pg = p.pagina;
    reg.registro.estadosProblem = ['En Análisis', 'En Solución', 'Cerrado'];
    reg.registro.subestadosProblem = ['En Análisis', 'Solucionado'];
    pg.fijarRol('ADM');
    reg.modificar('PRB 2026-000001');
    var ed = reg.edicion;
    editar(p, 'data-edicion', 'f_cierre', '2027-01-31');
    editar(p, 'data-edicion', 'f_analisis', '2026-02-30');
    var r = ed.revisar();
    Check('ED1 fecha invalida bloquea; la valida es un cambio', [false, true],
      [r.listo, r.cambios.some(function (c) { return c.clave === 'f_cierre' && c.nuevo === '2027-01-31'; })]);
    editar(p, 'data-edicion', 'f_analisis', '2026-12-01');
    editar(p, 'data-edicion', 'estado', 'Pausado');
    Check('ED2 Estado fuera de la lista bloquea', false, ed.revisar().listo);
    editar(p, 'data-edicion', 'estado', 'Cerrado');
    r = ed.revisar();
    Check('ED3 Estado de la lista: cambio', [true, true], [r.listo, r.cambios.some(function (c) { return c.clave === 'estado' && c.nuevo === 'Cerrado'; })]);
    Check('ED3 aviso: sin reglas de transicion', true, ed.notasLegado().some(function (n) { return /transición/.test(n); }));
    Check('ED4 sin Subestado en el registro: no se edita (no se sabe el actual)', true,
      /El registro no trajo el Subestado/.test(p.sel('regEdicion').innerHTML));
    Check('ED5 agregar una ruta que ya esta ligada: rechazo', false, reg.agregarCategoriaEdicion('/A/Cat 1').ok);
    Check('ED5b las rutas para agregar vienen del catalogo que cargo la pagina', ['/A/Cat 1', '/A/Cat 2', '/B/Cat 4'], reg.rutasCatalogo);
    Check('ED5c escribir una ruta que no existe: rechazo', false, reg.agregarCategoriaEdicion('/B/Cat').ok);
    Check('ED6 con catalogo: agregar una nueva', [true, 3], [reg.agregarCategoriaEdicion('/b/cat 4').ok, ed.categorias.filas.length]);
    var q = Elemento('q'); q.setAttribute('data-edicion-cat', 'quitar'); q.setAttribute('data-indice', '1');
    p.sel('regDetCuerpo').disparar('click', { target: q });
    Check('ED7 quitar una ligada: queda marcada, no se borra', [3, true], [ed.categorias.filas.length, ed.categorias.filas[1].quitada]);
    var pares = ed.paraEnviar();
    Check('ED8 lo que viaja: folio, fechas, estado, agregar y quitar', [
      ['accion', 'modificar'], ['folio', 'PRB 2026-000001'], ['f_cierre', '2027-01-31'], ['estado', 'Cerrado'],
      ['quitar_categoria', '/A/Cat 2'], ['agregar_categoria', '/B/Cat 4'], ['agregar_pct', '']], pares);
    Check('ED9 el codigo nunca viaja como cambio', false, ed.cambios().some(function (c) { return c.clave === 'folio' || c.clave === 'codigo'; }));
    var res = Elemento('r'); res.setAttribute('data-edicion-cat', 'restaurar'); res.setAttribute('data-indice', '1');
    p.sel('regDetCuerpo').disparar('click', { target: res });
    Check('ED10 restaurar la quitada', false, ed.categorias.filas[1].quitada);
    Check('ED11 la agregada pide su volumetria (en curso o ya resuelta)', true, !!reg.volumetria.estado('/B/Cat 4'));
    Check('ED12 el registro no cambia', ['En Análisis', 2], [reg.registro.buscar('PRB 2026-000001').estado,
      reg.registro.buscar('PRB 2026-000001').categorias.length]);
 
    return esperar().then(esperar).then(function () {
      Check('ED13 ... y la pide al servidor por GET', true, p.pedidos.some(function (x) {
        return x.metodo === 'GET' && /volumetria\.ashx\?ruta=%2FB%2FCat%204/.test(x.url); }));
      Check('ED14 su estado se pinta (error simulado: no se pudo consultar)', true, /No se pudo consultar/.test(p.sel('regEdCats').innerHTML));
    });
  });
});

// AD) Crear (ADM): borrador incompleto con varias categorias. Nada se
// inventa: lo que falta se nombra, incluido CUAL categoria no tiene %.
pruebas.push(function () {
  var cat = I.CatalogoIniciativas.desdeJson(CATALOGO);
  var b = new A.BorradorAdmin(cat);
  Check('AD1 vacio: no listo (sin tipo), incompleta, sin codigo ni guardado', [false, true, null, false],
    (function (r) { return [r.listo, r.incompleta, r.codigo, r.guardado]; })(b.revisar()));
  b.elegirTipo('ADO');
  b.agregarCategoria('/A/Cat 1'); b.agregarCategoria('/B/Cat 4');
  b.categorias.capturarPct(0, '20');
  var r = b.revisar();
  Check('AD2 con tipo y datos a medias: listo para validar, pero Incompleta', [true, true], [r.listo, r.incompleta]);
  Check('AD3 el faltante de % dice que categoria no lo tiene', true,
    r.faltantes.some(function (f) { return f.clave === 'pct' && /sin %: \/B\/Cat 4\)/.test(f.rotulo); }));
  Check('AD4 los campos vacios siguen vacios (no se rellenan)', ['', '', ''],
    [b.valores.titulo, b.valores.descripcion, b.valores.observaciones]);
  Check('AD5 viajan las dos categorias, la incompleta con % vacio', [['cat_ruta', '/A/Cat 1'], ['cat_pct', '20'], ['cat_ruta', '/B/Cat 4'], ['cat_pct', '']],
    b.paraEnviar().slice(7));
  Check('AD6 agregar otra no cambia el % ya escrito', [true, '20', ''],
    [b.agregarCategoria('/A/Cat 2').ok, b.categorias.filas[0].valor, b.categorias.filas[2].valor]);
  Check('AD7 duplicado rechazado', [false, 3], [b.agregarCategoria(' /a/cat 2').ok, b.categorias.filas.length]);
  Check('AD8 lo escrito que no es categoria: rechazo con parecidas, sin elegir', [false, true, 3],
    (function (x) { return [x.ok, /Parecidas: \/A\/Cat 1 · \/A\/Cat 2/.test(x.mensaje), b.categorias.filas.length]; })(b.agregarCategoria('cat')));
  Check('AD9 aviso de prototipo: no se guardo ni se genero codigo', true, /No se guardó nada y no se generó código/.test(r.aviso));
});

// LF) Ligar a un problema existente: varias categorias nuevas, cada una con
// su fecha de analisis de BORRADOR; las ligadas muestran la del problema.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro, pg = p.pagina;
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    var r = p.sel('admRutaExistente');
    r.value = 'existente'; r.checked = true; r.disparar('change');
    var b = Elemento('b'); b.setAttribute('data-existente', 'MAP 2026-000003');
    p.sel('admExistenteLista').disparar('click', { target: b });
    var ed = reg.edicion;
    var FG = p.ventana.IniciativaAdmin.FECHAS_GESTION, hoyOriginal = FG.hoy;
    FG.hoy = function () { return '2026-10-13'; };
    Check('LF1 elegido: su identidad real y su categoria ligada', ['MAP 2026-000003', ['/A/Cat 2']],
      [reg.abierta, ed.categorias.filas.map(function (f) { return f.categoria; })]);
    Check('LF2 agregar dos categorias nuevas', [true, true, 3],
      [reg.agregarCategoriaEdicion('/A/Cat 1').ok, reg.agregarCategoriaEdicion('/B/Cat 4').ok, ed.categorias.filas.length]);
    Check('LF3 duplicado (ligada o nueva) rechazado', [false, false, 3],
      [reg.agregarCategoriaEdicion('/a/cat 2').ok, reg.agregarCategoriaEdicion('/A/Cat 1').ok, ed.categorias.filas.length]);
    var html = p.sel('regEdCats').innerHTML;
    Check('LF4 columna Fecha de analisis: ligada = del problema (compartida); nuevas = PROPIAS calculadas, sin input', [true, true, 0, 2],
      [/Fecha de análisis<\/th>/.test(html), /01\/12\/2026<\/span> <span class="ini-origen derivado"[^>]*>Del problema/.test(html),
       (html.match(/data-edicion-fecha="/g) || []).length, (html.match(/title="Se liga el [^"]*">Calculada<\/span>/g) || []).length]);
    Check('LF4b cada nueva: su dia de ligado (hoy) y su analisis = hoy + 15', [true, true],
      [/28\/10\/2026<\/span> <span class="ini-origen derivado" title="Se liga el 13\/10\/2026: análisis = ese día \+ 15 días/.test(html),
       ed.categorias.filas.slice(1).every(function (f) { return f.fCreacion === '2026-10-13' && f.fAnalisis === '2026-10-28'; })]);
    editar(p, 'data-edicion-pct', '1', '30');
    Check('LF5 la ligada no toma fecha propia (usa la del problema)', ['', '2026-10-28', '2026-10-28'],
      ed.categorias.filas.map(function (f) { return f.fAnalisis || ''; }));
    Check('LF6 la regla cruza mes y anio', ['2027-01-15', '2026-03-16', ''],
      [A.FECHAS_GESTION.analisisDesde('2026-12-31'), A.FECHAS_GESTION.analisisDesde('2026-03-01'), A.FECHAS_GESTION.analisisDesde('31/12/2026')]);
    Check('LF7 fechas calculadas por categoria nueva', [{ categoria: '/A/Cat 1', f_creacion: '2026-10-13', f_analisis: '2026-10-28' },
                                                       { categoria: '/B/Cat 4', f_creacion: '2026-10-13', f_analisis: '2026-10-28' }],
      ed.categorias.fechasNuevas());
    FG.hoy = function () { return '2026-11-02'; };
    Check('LF8 una ligada otro dia lleva SU fecha; las ya agregadas no cambian', [true, ['', '2026-10-28', '2026-10-28', '2026-11-17'], ['', '30', '', '']],
      [(function () { ed.categorias.fijarRutas(['/A/Cat 1', '/A/Cat 2', '/B/Cat 4', '/C/Cat 9']); return reg.agregarCategoriaEdicion('/C/Cat 9').ok; })(),
       ed.categorias.filas.map(function (f) { return f.fAnalisis || ''; }), ed.categorias.filas.map(function (f) { return f.valor; })]);
    FG.hoy = hoyOriginal;
    var pares = ed.paraEnviar();
    Check('LF9 las fechas de categoria NO viajan (las fija el servidor); el codigo no cambia', [false, 'MAP 2026-000003', false],
      [pares.some(function (x) { return /fecha|f_analisis|f_creacion/.test(x[0]); }), pares[1][1], pares.some(function (x) { return x[0] === 'codigo'; })]);
    Check('LF10 la vista previa dice la fecha calculada', true,
      ed.cambios().some(function (c) { return /\/A\/Cat 1 · 30% · análisis 2026-10-28 \(hoy \+ 15 días\)/.test(c.nuevo); }));
    Check('LF11 nota del modelo: ligadas comparten la del problema; nuevas, la suya (+15); sin guardar', true,
      /las ligadas comparten la del problema \(dbo\.Problem\.FechaAnalisis\)\. Una categoría nueva tiene la suya: el día en que se liga \+ 15 días/.test(p.sel('regEdCats').innerHTML));
    Check('LF12 el registro no cambia', ['2026-12-01', 1], [reg.registro.buscar('MAP 2026-000003').f_analisis,
      reg.registro.buscar('MAP 2026-000003').categorias.length]);
    Check('LF13 una nueva sin % queda incompleta en el borrador, no se rellena', '', ed.categorias.filas[2].valor);
  });
});

// LC) Estado del catalogo de rutas: cargando y error no son "sin categorias".
pruebas.push(function () {
  Check('LC1 textos de estado', [true, true, true],
    [/Cargando el catálogo/.test(A.htmlSinCatalogo('cargando')), /No se pudo cargar el catálogo/.test(A.htmlSinCatalogo('error')),
     /no está disponible/.test(A.htmlSinCatalogo(''))]);
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.fijarRutasCatalogo(null, 'error');
    reg.modificar('PRB 2026-000001');
    Check('LC2 Modificar con error de catalogo: lo dice y no agrega', [true, false],
      [/No se pudo cargar el catálogo de categorías/.test(p.sel('regEdCats').innerHTML), reg.agregarCategoriaEdicion('/A/Cat 1').ok]);
    Check('LC3 el estado no se confunde con lista vacia', 'error', reg.rutasEstado);
  });
});

// SC) Solicitar cambios: varias categorias en una solicitud (DOM). Solo
// se prepara: ni peticiones ni guardado.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    p.pagina.fijarRol('MOD');
    reg.abrirDetalle('PRB 2026-000001');
    accion(p, 'solicitar-cambios');
    var form = p.sel('regCambio').innerHTML;
    elegir(p, 'regCambioCampo', 'pct');
    Check('SC1 Categorias: tabla con las ligadas y su % actual', [false, true, true],
      [p.sel('regCambioGrupoPct').hidden, /data-cambio-pct="0"/.test(form), /<td class="num">25%<\/td>/.test(form)]);
    p.sel('regCambioMotivo').value = 'Se amplia el alcance';
    var antes = p.pedidos.length;
    editar(p, 'data-cambio-pct', '1', '30');
    p.sel('regCambioCatBuscar').value = '/b/cat 4';
    accion(p, 'cambio-cat-agregar');
    var grupo = p.sel('regCambioGrupoPct').innerHTML;
    Check('SC2 agregar del catalogo: se pinta como nueva y el % pedido de la ligada se conserva', [true, true, true],
      [/\/B\/Cat 4<\/span> <span class="ini-cat-estado nueva">Agregar/.test(grupo), /data-cambio-pct="1" value="30"/.test(grupo),
       /data-cambio-nueva-pct="0"/.test(grupo)]);
    Check('SC3 solo se repinta el bloque de categorias: motivo y formulario intactos', ['Se amplia el alcance', form],
      [p.sel('regCambioMotivo').value, p.sel('regCambio').innerHTML]);
    p.sel('regCambioCatBuscar').value = '/A/Cat 1';
    accion(p, 'cambio-cat-agregar');
    Check('SC4 una ligada no se puede agregar otra vez', [true, 1], [/ya es una categoría de esta iniciativa/.test(p.sel('regCambioCatMsg').textContent), reg.cambio.nuevas.length]);
    p.sel('regCambioCatBuscar').value = '/B/Cat 4';
    accion(p, 'cambio-cat-agregar');
    Check('SC4b ni una nueva dos veces', [true, 1], [/ya está en la lista para agregar/.test(p.sel('regCambioCatMsg').textContent), reg.cambio.nuevas.length]);
    accion(p, 'cambio-preparar');
    Check('SC5 nueva sin %: no se prepara', [true, true], [/error/.test(p.sel('regCambioMsg').className), /\/B\/Cat 4: escribe un porcentaje/.test(p.sel('regCambioMsg').innerHTML)]);
    editar(p, 'data-cambio-nueva-pct', '0', '10');
    accion(p, 'cambio-preparar');
    var msg = p.sel('regCambioMsg').innerHTML;
    Check('SC6 preparada (no enviada) con las dos categorias', [true, true, true],
      [/Solicitud preparada, no enviada/.test(msg), /\/A\/Cat 2: 25% → 30%/.test(msg), /\/B\/Cat 4 \(agregar\): 10%/.test(msg)]);
    Check('SC7 sin peticiones al servidor; el registro no cambia', [antes, 0.25, 2],
      [p.pedidos.length, reg.registro.buscar('PRB 2026-000001').categorias[1].pct_dism, reg.registro.buscar('PRB 2026-000001').categorias.length]);
    var q = Elemento('q'); q.setAttribute('data-cambio-quitar', '0');
    p.sel('regDetCuerpo').disparar('click', { target: q });
    Check('SC8 quitar la agregada', [0, false], [reg.cambio.nuevas.length, /data-cambio-nueva-pct/.test(p.sel('regCambioGrupoPct').innerHTML)]);
    elegir(p, 'regCambioCampo', 'otros');
    accion(p, 'cambio-preparar');
    Check('SC9 Otros: solo explicacion, no cambia nada', [true, true],
      [/Solicitud preparada, no enviada/.test(p.sel('regCambioMsg').innerHTML), /no cambia nada por sí sola/.test(p.sel('regCambioMsg').innerHTML)]);
    Check('SC9b Otros aprobado no produce pares', null, new p.ventana.RegistroIniciativas.RevisionSolicitud(reg.cambio.resumen(), 'u').aprobar('a').pares);
  });
});

// SG) Seguimiento: Fecha de creacion y selector de categoria.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    var datos = JSON.parse(JSON.stringify(REGISTRO));
    datos.iniciativas[0].f_creacion = '2026-03-04';
    return reg.cargar(function () { return Promise.resolve(Respuesta(200, datos)); }).then(function () {
      p.pagina.fijarRol('ADM');
      reg.abrirDetalle('PRB 2026-000001');
      var html = p.sel('regDetCuerpo').innerHTML;
      var seg = (/<h4>Seguimiento<\/h4>[\s\S]*?<\/section>/.exec(html) || [''])[0];
      Check('SG1 Fecha de creacion en Seguimiento', true, /Fecha de creación<\/dt><dd>04\/03\/2026/.test(seg));
      Check('SG2 se conservan semaforo, tabla de compromisos y contadores', [true, true, true],
        [/ini-det-sem/.test(seg), /<th scope="col" class="num">Cambios<\/th>/.test(seg), /Análisis <span class="ini-sub">estado actual<\/span>/.test(seg)]);
      Check('SG3 selector con las categorias reales; la primera elegida', [true, true, true],
        [/<select id="regSegCategoria">/.test(seg), /<option value="\/A\/Cat 1" selected>/.test(seg), /<option value="\/A\/Cat 2">/.test(seg)]);
      Check('SG4 bloque de la primera: su % y fechas del problema marcadas compartidas', [true, true, true],
        [/% disminución<\/dt><dd>50%/.test(seg), /Del problema/.test(seg), /la base no guarda fechas por categoría/.test(seg)]);
      var cuerpo = p.sel('regDetCuerpo').innerHTML;
      p.sel('regBuscar').value = 'filtro escrito';
      function segElegir(v) { var t = p.sel('regSegCategoria'); t.value = v; p.sel('regDetCuerpo').disparar('change', { target: t }); }
      segElegir('/A/Cat 2');
      Check('SG5 cambiar de categoria repinta solo su bloque', [true, true, 'filtro escrito', '/A/Cat 2'],
        [/% disminución<\/dt><dd>25%/.test(p.sel('regSegCatInfo').innerHTML), p.sel('regDetCuerpo').innerHTML === cuerpo, p.sel('regBuscar').value, reg.segCategoria]);
      Check('SG6 las fechas son las del problema (no se inventan por categoria)', [true, true],
        [/Análisis<\/dt><dd>01\/12\/2026/.test(p.sel('regSegCatInfo').innerHTML), /las comparten sus 2 categorías/.test(p.sel('regSegCatInfo').innerHTML)]);
      segElegir('/Z/Inventada');
      Check('SG7 algo que no es categoria de la iniciativa: lo dice, no cambia la elegida', [true, '/A/Cat 2'],
        [/no es una categoría vigente/.test(p.sel('regSegCatInfo').innerHTML), reg.segCategoria]);
      reg.abrirDetalle('PRB 2026-000002');
      var sin = p.sel('regDetCuerpo').innerHTML;
      Check('SG8 sin categorias ni fecha de creacion: lo dice, sin inventar', [true, true],
        [/Sin categorías: las fechas son las del problema/.test(sin), /Fecha de creación<\/dt><dd>—/.test(sin)]);
      // Umbral: 20 categorias = <select>; 21 = caja con busqueda.
      function con(n) {
        var d = JSON.parse(JSON.stringify(REGISTRO)), cats = [];
        for (var k = 1; k <= n; k++) cats.push(Cat('/R/' + k, 0.01));
        d.iniciativas[0].categorias = cats;
        return reg.cargar(function () { return Promise.resolve(Respuesta(200, d)); }).then(function () {
          reg.abrirDetalle('PRB 2026-000001');
          return p.sel('regDetCuerpo').innerHTML;
        });
      }
      return con(20).then(function (h20) {
        return con(21).then(function (h21) {
          Check('SG9 umbral del selector: 20 select, 21 caja con busqueda', [true, false, true, true],
            [/<select id="regSegCategoria">/.test(h20), /list="regSegCategoria-lista"/.test(h20),
             /<input type="text" id="regSegCategoria" list="regSegCategoria-lista"/.test(h21), /<datalist id="regSegCategoria-lista">/.test(h21)]);
          var t = p.sel('regSegCategoria');
          t.value = '/r/21';
          p.sel('regDetCuerpo').disparar('input', { target: t });
          Check('SG10 escribir en la caja (sin mayusculas) elige la real', '/R/21', reg.segCategoria);
        });
      });
    });
  });
});

// PS) Las dos persistencias siguen apagadas (constantes en el servidor).
pruebas.push(function () {
  Check('PS1 PersistenciaGestionAdmin.Habilitada = false', true,
    /class PersistenciaGestionAdmin[\s\S]*?public const bool Habilitada = false;/.test(leer('App_Code/GestionIniciativaAdmin.cs')));
  Check('PS2 AltaCategoriaProactivanet.Habilitada = false', true,
    /public const bool Habilitada = false;/.test(leer('App_Code/AltaCategoriaProactivanet.cs')));
  Check('PS3 ningun "true" para Habilitada', false,
    /Habilitada\s*=\s*true/.test(leer('App_Code/GestionIniciativaAdmin.cs') + leer('App_Code/AltaCategoriaProactivanet.cs')));
});

pruebas.reduce(function (cadena, prueba) { return cadena.then(prueba); }, Promise.resolve())
  .then(function () {
    console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
    process.exit(fallos ? 1 : 0);
  }, function (err) {
    console.log('ERROR ' + (err && err.stack || err));
    process.exit(1);
  });
