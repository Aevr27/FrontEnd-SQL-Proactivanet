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
//   E) Edicion directa en el detalle del registro (reemplaza "Modificar"):
//      solo ADM, campos editables en su lugar, barra "Cambios sin guardar",
//      Cancelar, faltantes, formato, rol que cambia con el panel abierto.
//   EC) Cambios sin guardar: cerrar, otra fila, otra pestaña y salir de la
//      pagina preguntan; Cancelar con el foco en un campo queda limpio.
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
//   MT) Crear: meta en % o en tickets (redondeo, exactitud, division por cero,
//      lo escrito nunca se pisa) y Volumetria fijada por ADM solo con sql/26;
//      Modificar intacto.
//   SB) Crear: Subestado inicial solo con sql/27 (subestado_alta); opciones
//      = subestados_problem; sin elegir no viaja; elegirlo no toca el Estado.
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
// `volumetria` = los ultimos 30 dias (SLOT 0 por omision; ultimos30 con
// alcance=total). HISTORICO = el total de la categoria que alcance=total
// tambien manda (y que la pantalla ya NO pinta): /A/Cat 2 tiene 74 tickets
// historicos y 0 en los ultimos 30 dias.
var HISTORICO = { '/A/Cat 1': 5000, '/A/Cat 2': 74 };
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
function Cat(ruta, pct, o) {
  var c = { categoria: ruta, tickets_reduce: 10, pct_dism: pct, director: 'Dir A', po: 'PO 1', so: 'SO x', agrup: 'Problem' };
  Object.keys(o || {}).forEach(function (k) { c[k] = o[k]; });
  return c;
}
var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'],
  agrupadores: ['Problem'], fecha_gen: '09/10/2026',
  tipos_iniciativa: CATALOGO.tipos,
  estados_problem: ['Cerrado', 'En Análisis', 'En Solución'],
  valores_tipo_iniciativa: ['Mejora', 'Problem'],
  valores_tipo_agrupado: ['Adopcion', 'Problem'],
  iniciativas: [
    // PO / SO capturados (po_capturado / so_capturado): los de la lista.
    Ini('PRB 2026-000001', { categorias: [Cat('/A/Cat 1', 0.5), Cat('/A/Cat 2', 0.25)],
                             po_capturado: 'PO 1', so_capturado: 'SO x' }),                       // completa
    Ini('PRB 2026-000002', { sin_categoria: true, observaciones: null }),                        // sin categoria ni obs.
    Ini('MAP 2026-000003', { prefijo: 'MAP', estado: 'En Solución', f_solucion: null,
                             categorias: [Cat('/A/Cat 2', null)], po_capturado: 'PO 1', so_capturado: 'SO y' }) // sin % y sin fecha
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
      var f = v || { ruta: ruta, estado: 'cero', volumetria: 0 };
      if (/alcance=total/.test(url)) {
        // Como VolumetriaTotalCategoria.Armar: el estado sale del total.
        var hist = HISTORICO[ruta] || f.volumetria;
        return Promise.resolve(Respuesta(200, { alcance: 'total', rutas: [{ ruta: ruta, llave: ruta, estado: hist > 0 ? 'ok' : 'cero',
          volumetria: hist, ultimos30: f.volumetria }] }));
      }
      return Promise.resolve(Respuesta(200, { slot: 0, rutas: [f] }));
    }
    return Promise.reject(new Error('peticion inesperada ' + url));
  }
  (new Function('window', leer('assets/js/escape.js')))(ventana);
  (new Function('window', leer('assets/js/duracion.js')))(ventana);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(ventana, ventana.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(ventana, documento);
  (new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
  if (conAdmin !== false) {
    (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', leer('admin/iniciativa-admin.js')))(
      ventana, documento, ventana.Catalogos, ventana.Escape, ventana.Duracion);
  }
  (new Function('window', leer('assets/js/seleccion-kpi.js')))(ventana);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', 'fetch', leer('admin/registro-iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.Duracion, pedir);
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
  Check('I12 el borrador: la lista completa, sin Volumetria (es calculada); Clasificacion, Agrupacion y Estado como faltantes', ['categoria', 'titulo', 'descripcion', 'observaciones', 'pct', 'rca', 'tipo_iniciativa', 'tipo_agrupado', 'estado'],
    A.CAMPOS_INCOMPLETA.map(function (c) { return c.clave; }));
});

// ---------------------------------------------------------------------------
// B) BorradorAdmin
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var cat = I.CatalogoIniciativas.desdeJson(CATALOGO);
  var b = new A.BorradorAdmin(cat);
  var r = b.revisar();
  Check('B1 sin tipo: bloquea solo el Tipo (Clasificacion, Agrupacion y Estado pueden faltar)',
    [false, ['tipo']], [r.listo, claves(r.bloqueantes)]);
  b.elegirTipo('ADO');
  Check('B1c Clasificacion y Agrupacion salen del Tipo; sin Estado: se puede validar, Incompleta solo por Estado', [true, ['estado'], 'Adopción', 'Adopción'],
    [b.revisar().listo, claves(b.faltantes()).filter(function (k) { return /^(tipo_iniciativa|tipo_agrupado|estado)$/.test(k); }),
     b.declarados.tipo_iniciativa, b.paraEnviar().filter(function (c) { return c[0] === 'tipo_agrupado'; })[0][1]]);
  b.capturar('tipo_iniciativa', 'Problem');
  b.capturar('tipo_agrupado', 'Problem');
  Check('B1d Clasificacion y Agrupacion no se capturan a mano', ['Adopción', 'Adopción'], [b.declarados.tipo_iniciativa, b.declarados.tipo_agrupado]);
  b.elegirTipo('PRB');
  Check('B1e otro Tipo las cambia', ['Problem', 'Problem'], [b.declarados.tipo_iniciativa, b.declarados.tipo_agrupado]);
  b.elegirTipo('');
  Check('B1f sin Tipo: vacias', ['', ''], [b.declarados.tipo_iniciativa, b.declarados.tipo_agrupado]);
  Check('B1g regla completa (los 9 prefijos de CatPrefijoProblem; sin regla = vacio)',
    ['Adopción|Adopción', 'Hardware|ReqOpr', 'Mejora Aplicativo|Mejora', 'Problem|Problem', 'Requerimiento|ReqOpr',
     'Requerimiento TI a TI|ReqOpr', 'Shift Left Administrador|Adopción', 'SorIA_KB|SorIA', 'SorIA|SorIA', '|', 'Problem|Problem'],
    ['ADO', 'HAR', 'MAP', 'PRB', 'REQ', 'RTI', 'S2L', 'SKB', 'SOR', 'XYZ', ' prb '].map(function (p) {
      var c = A.TiposPorPrefijo.clasificacion(p);
      return c + '|' + A.TiposPorPrefijo.agrupacion(c);
    }));
  Check('B1b la entrega del analisis empieza en hoy', A.FECHAS_GESTION.hoy(), b.declarados.f_entrega_analisis);
  b.capturar('tipo_iniciativa', 'Problem');
  b.capturar('tipo_agrupado', ' Problem ');
  b.capturar('estado', 'En Análisis');

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
  b.capturar('f_entrega_analisis', '2026-02-30');
  Check('B13 fecha de entrega invalida bloquea', [false, ['f_entrega_analisis']], [b.revisar().listo, claves(b.revisar().formato)]);
  b.capturar('f_entrega_analisis', '2026-10-20');
  var envio = {};
  b.paraEnviar().forEach(function (c) { envio[c[0]] = c[1]; });
  Check('B14 viajan los declarados (sin espacios) y la entrega', ['Problem', 'Problem', 'En Análisis', '2026-10-20'],
    [envio.tipo_iniciativa, envio.tipo_agrupado, envio.estado, envio.f_entrega_analisis]);
  Check('B15 en el alta, las categorias NO piden tipos por fila (llevan los del alta)', [],
    b.categorias.erroresFormato().filter(function (e) { return e.clave === 'categorias'; }));
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

    // Nueva solicitud intacta: PRB exige todos los campos; el RCA va por
    // correo (Iniciativas.RCA.enSitio = false), no se pide.
    var s = pg.solicitud;
    s.elegirTipo('PRB');
    Check('S6 Nueva solicitud: PRB exige todos los campos (RCA por correo, no se pide)', [true, false],
      [['tipo', 'po', 'so', 'categoria', 'titulo', 'analisis', 'observaciones', 'volumetria', 'pct'].slice(1)
        .every(function (k) { return s.faltantes().indexOf(k) >= 0; }), s.faltantes().indexOf('rca') >= 0]);
    Check('S7 borradores separados: el de ADM no es el de la solicitud', true, pg.crearAdmin.borrador !== s);

    // C) el panel
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    Check('C1 tipos del catalogo con su Descripcion', ['PRB', 'ADO', 'MAP'], p.sel('admTipo').opciones());
    Check('C2 selector de categoria con las rutas (3 <= 20: select normal)', [false, true, 3],
      [p.sel('admCatAgregar').disabled, /<select id="admCatBuscar"/.test(p.sel('admCatSelector').innerHTML),
       (p.sel('admCatSelector').innerHTML.match(/<option value="\//g) || []).length]);
    elegir(p, 'admTipo', 'PRB');
    Check('C2b Clasificacion y Agrupacion del Tipo (solo lectura); Estado con los valores del registro; entrega = hoy', ['Problem', 'Problem', ['Cerrado', 'En Análisis', 'En Solución'], A.FECHAS_GESTION.hoy()],
      [p.sel('admTipoIniciativa').textContent, p.sel('admTipoAgrupado').textContent, p.sel('admEstado').opciones(), p.sel('admFEntrega').value]);
    elegir(p, 'admEstado', 'En Análisis');
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
    Check('C8 el codigo no se inventa: lo asigna el servidor al guardar', 'Se asigna al guardar (PPP AAAA-NNNNNN, el siguiente del prefijo y año)',
      (/<output id="admCodigo"[^>]*>([^<]*)<\/output>/.exec(leer('admin/iniciativas.html')) || [])[1]);
  });
});

// ---------------------------------------------------------------------------
// E) Edicion directa en el detalle (antes "Modificar") + M) marca Incompleta
// ---------------------------------------------------------------------------
function htmlEditable(p) {
  return ['regDetIdent', 'regDetEtapas', 'regDetCats', 'regDetDesc'].map(function (id) { return p.sel(id).innerHTML; }).join('');
}
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    reg.abrirDetalle('PRB 2026-000001');
    var det = p.sel('regDetCuerpo').innerHTML;
    Check('E1 sin rol: solo lectura (sin controles, sin barra, sin boton Modificar)', [false, false, false, null],
      [/data-edicion/.test(det), /id="regEdBarra"/.test(det), />Modificar<\/button>/.test(det), reg.edicion]);
    accion(p, 'editar-admin');
    Check('E2 sin rol: la accion no abre nada', null, reg.edicion);
    // Solicitar cambios es de ADM y MOD (el servidor lo exige): sin rol, el
    // registro es solo lectura.
    Check('E3 sin rol: sin Solicitar cambios', false, /Solicitar cambios/.test(p.sel('regDetCuerpo').innerHTML));
    accion(p, 'solicitar-cambios');
    Check('E3 sin rol: la accion Solicitar cambios no abre nada', [false, false], [!!reg.cambioAbierto, /regCambioCampo/.test(p.sel('regCambio').innerHTML)]);

    p.pagina.fijarRol('ADM');
    var html = htmlEditable(p), barra = p.sel('regEdBarraCaja').innerHTML;
    Check('E4 ADM con el detalle abierto: los campos se vuelven editables en su lugar; sin boton Modificar', [true, false, true],
      [!!reg.edicion, />Modificar<\/button>/.test(p.sel('regDetAcciones').innerHTML), /Edición directa \(ADM\)/.test(p.sel('regDetAcciones').innerHTML)]);
    Check('E4b el rotulo del detalle deja de decir Solo lectura', 'Edición directa (ADM)', p.sel('regDetModo').textContent);
    Check('E5 barra: Guardar que solo valida (persistencia no habilitada) y Cancelar; oculta sin cambios', [true, true, true, true, true],
      [/data-accion="edicion-guardar"[^>]*>Validar en el servidor \(no guarda\)<\/button>/.test(barra),
       /data-accion="edicion-cancelar"[^>]*>Cancelar<\/button>/.test(barra), /la persistencia no está habilitada/.test(barra),
       /id="regEdBarra"[^>]*hidden/.test(barra), p.sel('regEdBarra').hidden]);
    Check('E5b ningun boton "Guardar" a secas', false, /<button[^>]*>\s*Guardar\s*<\/button>/.test(barra));
    Check('E6 Codigo, Agrupacion y Antiguedad siguen de solo lectura; Organizacion e Impacto sin controles', [true, true, false],
      [/<dt>Código<\/dt><dd>PRB 2026-000001<\/dd>/.test(html), /<dt>Agrupación<\/dt><dd>Problem<\/dd>/.test(html),
       /data-edicion="(codigo|duenos|tickets|manager)/.test(p.sel('regDetCuerpo').innerHTML)]);
    Check('E6b titulo (encabezado), descripcion y observaciones se VEN con su valor y se editan con un clic; Estado, fechas y categorias son controles',
      [true, true, true, true, true, true, false],
      [/<div class="ini-ed-mostrar ini-det-nombre" id="regEdVer-titulo"[^>]*data-editar="titulo"[^>]*>T PRB 2026-000001<\/div>/.test(p.sel('regDetNombre').innerHTML),
       /<select id="regEd-estado" class="ini-dd-categoria ini-ed-campo[^"]*" data-edicion="estado"/.test(p.sel('regDetIdent').innerHTML),
       /type="date" id="regEd-f_analisis" data-edicion="f_analisis"[^>]*value="2026-12-01"/.test(p.sel('regDetEtapas').innerHTML),
       /data-editar="descripcion"[^>]*>Desc PRB 2026-000001<\/div>/.test(p.sel('regDetDesc').innerHTML),
       /data-editar="observaciones"[^>]*>Obs PRB 2026-000001<\/div>/.test(p.sel('regDetDesc').innerHTML),
       /id="regEdCats"/.test(p.sel('regDetCats').innerHTML),
       /<dt>Título/.test(p.sel('regDetIdent').innerHTML)]);

    var titulo = Elemento('control');
    titulo.setAttribute('data-edicion', 'titulo');
    titulo.value = 'Nuevo titulo';
    p.sel('regDetCuerpo').disparar('input', { target: titulo });
    Check('E6c el control tocado queda marcado; la barra aparece con la cuenta', [true, false, '1 cambio sin guardar'],
      [titulo.classList.contains('ini-ed-cambiado'), p.sel('regEdBarra').hidden, p.sel('regEdSucio').textContent]);
    editar(p, 'data-edicion', 'descripcion', '');
    editar(p, 'data-edicion-pct', '1', '30');
    Check('E6d tres cambios', '3 cambios sin guardar', p.sel('regEdSucio').textContent);
    var r = reg.revisarEdicion();
    Check('E7 cambios detectados', ['titulo', 'descripcion', 'pct'], claves(r.cambios));
    Check('E8 vaciar Descripcion NO marca incompleta a una existente', [true, false, []],
      [r.listo, r.incompleta, claves(r.faltantes)]);
    Check('E9 la revision local nunca dice guardado', [false, false],
      [r.guardado, /Guardado/.test(p.sel('regEdMsg').innerHTML)]);
    editar(p, 'data-edicion-pct', '0', '');
    r = reg.revisarEdicion();
    Check('E8b vaciar un % si la marca incompleta (no bloquea)', [true, true, ['pct']],
      [r.listo, r.incompleta, claves(r.faltantes)]);
    editar(p, 'data-edicion-pct', '0', '101');
    r = reg.revisarEdicion();
    Check('E10 % fuera de rango si bloquea, con mensaje entendible', [false, 'error', true],
      [r.listo, /error/.test(p.sel('regEdMsg').className) ? 'error' : '', /entre 0 y 100/.test(p.sel('regEdMsg').innerHTML)]);
    Check('E11 el registro no cambia (solo el borrador)', ['T PRB 2026-000001', 0.5],
      [reg.registro.buscar('PRB 2026-000001').titulo, reg.registro.buscar('PRB 2026-000001').categorias[0].pct_dism]);

    // Cancelar: vuelve a lo guardado; Solicitar cambios abierto no se toca.
    accion(p, 'solicitar-cambios');
    var cambio = reg.cambio;
    accion(p, 'edicion-cancelar');
    Check('E11b Cancelar: borrador = lo guardado, sin cambios, barra oculta, controles con los valores guardados',
      [0, 'T PRB 2026-000001', '50', true, true, true],
      [reg.edicion.cambios().length, reg.edicion.valores.titulo, reg.edicion.valores.pct[0].valor, p.sel('regEdBarra').hidden,
       /data-editar="titulo"[^>]*>T PRB 2026-000001<\/div>/.test(p.sel('regDetNombre').innerHTML),
       /data-edicion-pct="0" value="50"/.test(p.sel('regDetCats').innerHTML)]);
    Check('E11c ... Solicitar cambios sigue abierto con su borrador', [true, true, false],
      [reg.cambioAbierto, reg.cambio === cambio, p.sel('regCambio').hidden]);
    accion(p, 'cambio-cancelar');

    p.pagina.fijarRol('MOD');
    Check('E12 perder ADM: sin borrador, sin controles, sin barra; el rotulo vuelve a Solo lectura', [null, false, '', 'Solo lectura'],
      [reg.edicion, /data-edicion/.test(htmlEditable(p)), p.sel('regEdBarraCaja').innerHTML, p.sel('regDetModo').textContent]);

    var editables = A.EdicionAdmin.campos('editable').map(function (c) { return c.clave; });
    Check('E13 editables propuestos (PO / SO capturados con sql/24; nunca codigo)', ['titulo', 'descripcion', 'observaciones', 'f_analisis', 'f_solucion', 'f_cierre',
      'estado', 'subestado', 'po', 'so', 'categorias'], editables);
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

// EC) Cambios sin guardar: cerrar, cambiar de iniciativa o de pestaña y
//     salir de la pagina preguntan antes de descartar.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro, pg = p.pagina, preguntas = [], responde = false;
    reg.confirmar = function (m) { preguntas.push(m); return responde; };
    pg.fijarRol('ADM');
    reg.abrirDetalle('PRB 2026-000001');
    Check('EC1 sin cambios: cerrar no pregunta', [true, 0, null], [reg.cerrarDetalle(), preguntas.length, reg.abierta]);
    reg.abrirDetalle('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Otro');
    Check('EC2 con cambios: cerrar pregunta; "no" deja todo abierto con lo escrito', [false, 1, 'PRB 2026-000001', 'Otro', false],
      [reg.cerrarDetalle(), preguntas.length, reg.abierta, reg.edicion.valores.titulo, p.sel('regDetalle').hidden]);
    Check('EC2 ... el mensaje dice cuantos y de cual', true, /Hay 1 cambio sin guardar en PRB 2026-000001/.test(preguntas[0]));
    var esc = { key: 'Escape' };
    p.doc.disparar('keydown', esc);
    p.sel('regDetFondo').disparar('click');
    p.sel('regDetCerrar').disparar('click');
    Check('EC3 Escape, el fondo y la X preguntan igual (y no cierran)', [4, 'PRB 2026-000001'], [preguntas.length, reg.abierta]);
    var fila = Elemento('fila');
    fila.setAttribute('data-folio', 'MAP 2026-000003');
    p.sel('regCuerpo').disparar('click', { target: fila });
    Check('EC4 abrir otra fila pregunta; "no" se queda en la misma', [5, 'PRB 2026-000001'], [preguntas.length, reg.abierta]);
    p.sel('tab-solicitudes').disparar('click');
    Check('EC5 cambiar de pestaña pregunta; "no" se queda en Iniciativas con el detalle', [6, 'iniciativas', 'PRB 2026-000001'],
      [preguntas.length, pg.vista, reg.abierta]);
    var salida = { returnValue: undefined, preventDefault: function () { this.prevenido = true; } };
    p.ventana.disparar('beforeunload', salida);
    Check('EC6 salir de la pagina con cambios: el navegador avisa', [true, ''], [salida.prevenido, salida.returnValue]);
    responde = true;
    p.sel('regCuerpo').disparar('click', { target: fila });
    Check('EC7 "si": se descartan y abre la otra', ['MAP 2026-000003', 0], [reg.abierta, reg.edicion.cambios().length]);
    var limpia = { returnValue: undefined, preventDefault: function () { this.prevenido = true; } };
    p.ventana.disparar('beforeunload', limpia);
    Check('EC8 sin cambios: salir no avisa', undefined, limpia.prevenido);
    reg.confirmar = null;
    editar(p, 'data-edicion', 'titulo', 'X');
    Check('EC9 sin forma de preguntar (sin confirm): no se descarta nada', [false, 'MAP 2026-000003'], [reg.cerrarDetalle(), reg.abierta]);
    Check('EC10 recargar el registro o perder el acceso cierra sin preguntar', [true, null], [reg.cerrarDetalle(true), reg.abierta]);

    // El navegador manda "change" del control enfocado al quitarlo del DOM:
    // Cancelar lo desenfoca ANTES de armar el borrador nuevo.
    reg.abrirDetalle('PRB 2026-000001');
    var enfocado = Elemento('control');
    enfocado.setAttribute('data-edicion', 'titulo');
    enfocado.value = 'Escrito y enfocado';
    enfocado.blur = function () { enfocado.desenfocado = true; p.sel('regDetCuerpo').disparar('change', { target: enfocado }); };
    p.sel('regDetCuerpo').disparar('input', { target: enfocado });
    p.doc.activeElement = enfocado;
    p.sel('regDetCuerpo').contains = function (el) { return el === enfocado; };
    accion(p, 'edicion-cancelar');
    Check('EC11 Cancelar con el campo enfocado: se desenfoca antes y el borrador nuevo queda limpio', [true, 0, 'T PRB 2026-000001', true],
      [enfocado.desenfocado === true, reg.edicion.cambios().length, reg.edicion.valores.titulo, p.sel('regEdBarra').hidden]);
    p.doc.activeElement = null;
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
    Check('VW4 la pagina pasa la respuesta de SesionAdmin a aplicarSesion y vigila los 403 con revisarSesion', [true, true, true],
      [/sesion\.aplicar\(document, saludo, correo\)\.then\(function \(s\) \{\s*if \(window\.IniciativasPagina\) window\.IniciativasPagina\.aplicarSesion\(s\);/.test(html),
       /sesion\.vigilar\(function \(s\) \{\s*if \(!window\.IniciativasPagina \|\| !window\.IniciativasPagina\.revisarSesion\(s\)\) return;\s*sesion\.pintar\(document, s, saludo, correo\);/.test(html),
       /getElementById\('iniVerificarReintentar'\)\.addEventListener\('click', aplicarSesion\)/.test(html)]);
  });
});

// VS) aplicarSesion / revisarSesion: la pagina segun admin_sesion, al abrir
// y con la pagina ya abierta (un 403 de Admin). Solo UX: el servidor ya
// niega (AccesoIniciativasHttpSmoke). Regla (2026-10-28): el registro es de
// todos (registro); Nueva solicitud y Solicitudes de ADM, MOD y PO/SO
// (solicitante); Administracion solo ADM.
pruebas.push(function () {
  var SES = {
    adm: { autorizado: true, rol: 'ADM', solicitante: true, registro: true, incierto: false },
    mod: { autorizado: true, rol: 'MOD', solicitante: true, registro: true, incierto: false },
    poso: { autorizado: false, rol: null, solicitante: true, registro: true, incierto: false },
    comun: { autorizado: false, rol: null, solicitante: false, registro: true, incierto: false },
    nada: { autorizado: false, rol: null, solicitante: false, registro: false, incierto: false },
    // Fallo la consulta del rol o de los dueños: no se pudo confirmar.
    incierto: { autorizado: false, rol: null, solicitante: true, registro: true, incierto: true }
  };
  // false = visible.
  function estado(p) {
    var pg = p.pagina;
    return { rol: pg.rol, denegada: !!pg.denegada, tabs: p.sel('iniTabs').hidden, verificar: p.sel('iniVerificar').hidden,
      ini: p.sel('panel-iniciativas').hidden, nueva: p.sel('panel-nueva').hidden,
      sol: p.sel('tab-solicitudes').hidden, admin: p.sel('tab-administracion').hidden };
  }
  var a = Pagina(), b = Pagina(), c = Pagina(), c2 = Pagina(), d = Pagina(), e = Pagina(), f = Pagina();
  // Como en el marcado: el aviso de Reintentar nace oculto y la pestaña se
  // llama Iniciativas.
  [a, b, c, c2, d, e, f].forEach(function (p) { p.sel('iniVerificar').hidden = true; p.sel('tab-iniciativas').textContent = 'Iniciativas'; });
  return esperar().then(function () {
    // Al abrir.
    a.pagina.aplicarSesion(SES.incierto);
    Check('VS1 incierto: el registro a la vista con Reintentar; sin Solicitudes ni Administracion; ni denegar',
      { rol: null, denegada: false, tabs: false, verificar: false, ini: false, nueva: true, sol: true, admin: true }, estado(a));
    a.pagina.mostrarVista('nueva');
    Check('VS1 ... Nueva solicitud no abre sin confirmar', true, a.sel('panel-nueva').hidden);
    a.pagina.aplicarSesion(SES.adm);
    Check('VS2 Reintentar con respuesta confirmada ADM: vuelve la pagina entera',
      { rol: 'ADM', denegada: false, tabs: false, verificar: true, ini: false, nueva: true, sol: false, admin: false }, estado(a));

    b.pagina.aplicarSesion(SES.poso);
    Check('VS3 PO/SO sin rol: el registro, con Solicitudes; sin Administracion',
      { rol: null, denegada: false, tabs: false, verificar: true, ini: false, nueva: true, sol: false, admin: true }, estado(b));
    b.pagina.mostrarVista('nueva');
    Check('VS3 ... abre Nueva solicitud; la pestaña sigue llamandose Iniciativas', [false, 'Iniciativas'],
      [b.sel('panel-nueva').hidden, b.sel('tab-iniciativas').textContent]);
    b.pagina.mostrarVista('administracion');
    Check('VS3 ... Administracion no abre', true, b.sel('panel-administracion').hidden);

    c.pagina.aplicarSesion(SES.comun);
    Check('VS4 cuenta comun (sin rol ni PO/SO): solo el registro',
      { rol: null, denegada: false, tabs: false, verificar: true, ini: false, nueva: true, sol: true, admin: true }, estado(c));
    c.pagina.mostrarVista('nueva');
    c.pagina.mostrarVista('solicitudes');
    Check('VS4 ... ni Nueva solicitud ni Solicitudes abren', [true, true, false],
      [c.sel('panel-nueva').hidden, c.sel('panel-solicitudes').hidden, c.sel('panel-iniciativas').hidden]);
    c2.pagina.aplicarSesion(SES.nada);
    Check('VS4b sin cuenta (registro false): denegar, sin pestañas', [true, false, true],
      [c2.pagina.denegada, c2.sel('iniDenegado').hidden, c2.sel('iniTabs').hidden]);
    Check('VS5 revisarSesion antes de decidir: no hace nada', false, d.pagina.revisarSesion(SES.nada));

    // Con la pagina abierta: ADM -> sale de UsuariosAdmin siendo PO/SO.
    d.pagina.aplicarSesion(SES.adm);
    d.pagina.mostrarVista('nueva');
    var borrador = d.pagina.solicitud;
    Check('VS6 ADM pierde el rol siendo PO/SO: repinta el menu', true, d.pagina.revisarSesion(SES.poso));
    Check('VS6 ... sigue en Nueva solicitud con el MISMO borrador, sin rol ni Administracion',
      [null, true, false, true, false], [d.pagina.rol, d.pagina.solicitud === borrador, d.sel('panel-nueva').hidden,
        d.sel('tab-administracion').hidden, d.sel('iniAvisoSesion').hidden]);
    Check('VS6 ... el aviso dice que ya no hay administracion', true, /Ya no tienes acceso a la administración/.test(d.sel('iniAvisoSesion').textContent));
    d.sel('tab-iniciativas').disparar('click');
    Check('VS6 ... la pestaña Iniciativas abre el registro (es de todos)', false, d.sel('panel-iniciativas').hidden);
    d.pagina.mostrarVista('nueva');
    // ... y luego deja de ser PO/SO: sale de Nueva solicitud al registro; el
    // borrador sigue en memoria; no se niega la pagina.
    d.pagina.revisarSesion(SES.comun);
    Check('VS7 solicitante que lo pierde: vuelve al registro, sin Solicitudes; no se niega ni se borra el borrador',
      [false, true, false, true, true], [!!d.pagina.denegada, d.sel('panel-nueva').hidden, d.sel('panel-iniciativas').hidden,
        d.sel('tab-solicitudes').hidden, d.pagina.solicitud === borrador]);
    Check('VS7 ... el aviso lo dice', true, /ya no está disponible para tu cuenta/.test(d.sel('iniAvisoSesion').textContent));

    // ADM -> MOD: sigue en Nueva solicitud (MOD tambien solicita), sin lo de ADM.
    e.pagina.aplicarSesion(SES.adm);
    e.pagina.mostrarVista('nueva');
    e.pagina.revisarSesion(SES.mod);
    Check('VS8 ADM pasa a MOD: rol MOD, sigue en Nueva solicitud, Administracion oculta',
      ['MOD', true, false, true], [e.pagina.rol, e.sel('panel-iniciativas').hidden, e.sel('panel-nueva').hidden, e.sel('tab-administracion').hidden]);
    // ADM -> sin cuenta: denegar con el mensaje.
    e.pagina.revisarSesion(SES.nada);
    Check('VS9 pierde todo: denegar con el aviso de que ya no esta vigente, sin pestañas', [true, false, true, true],
      [e.pagina.denegada, e.sel('iniDenegado').hidden, /ya no está vigente/.test(e.sel('iniDenegadoTexto').textContent), e.sel('iniTabs').hidden]);

    // ADM con la pagina abierta y la consulta del rol falla: no se niega
    // por un error; queda el registro con Reintentar.
    f.pagina.aplicarSesion(SES.adm);
    Check('VS10 un 403 + rol incierto: Reintentar y el registro; ni denegar ni Administracion', [true, false, false, false, true],
      [f.pagina.revisarSesion(SES.incierto), f.pagina.denegada === true, f.sel('iniVerificar').hidden, f.sel('panel-iniciativas').hidden,
       f.sel('tab-administracion').hidden]);
    f.pagina.revisarSesion(SES.adm);
    Check('VS11 ... y la respuesta confirmada ADM lo devuelve todo', [true, false], [f.sel('iniVerificar').hidden, f.sel('tab-administracion').hidden]);
  });
});

// HT) Pestañas ocultas de verdad: .ini-tabs pone display:flex, que le gana
// al [hidden] del navegador; sin .ini-tabs[hidden] la barra seguia a la
// vista bajo "No tienes acceso" (denegar).
pruebas.push(function () {
  var css = leer('admin/iniciativas.css').replace(/\/\*[\s\S]*?\*\//g, '');
  Check('HT1 .ini-tabs[hidden] { display: none } en iniciativas.css', true, /\.ini-tabs\[hidden\]\s*\{\s*display:\s*none;?\s*\}/.test(css));
  Check('HT2 ... despues de la regla display:flex de .ini-tabs', true,
    css.search(/\.ini-tabs\[hidden\]/) > css.search(/\.ini-tabs\s*\{[^}]*display:\s*flex/));
  return Promise.resolve();
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
  var tabs = [], re = /<button[^>]*role="tab"[^>]*id="([^"]+)"[^>]*>([^<]*)(?:<span class="ini-tab-aviso"[^>]*><\/span>)?<\/button>/g, m;
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
        : tag && / data-solo-admin[\s>]/.test(tag[0]) ? '[data-solo-admin]'
        : tag && / data-solo-solicitud[\s>]/.test(tag[0]) ? '[data-solo-solicitud]' : '';
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
    visibles(r({ autorizado: true, rol: 'ADM', solicitante: true })),
    visibles(r({ autorizado: true, rol: 'MOD', solicitante: true })),
    visibles(r({ autorizado: false })),
    visibles(null),
    visibles(r({ autorizado: true, rol: 'MOD', solicitante: false }))
  ]).then(function (v) {
    Check('CB3 ADM ve Solicitar y Crear', ['btnSolicitar', 'btnCrearAdmin'], v[0]);
    Check('CB3 MOD PO/SO vigente ve Solicitar y no Crear', ['btnSolicitar'], v[1]);
    Check('CB3 VIEWER (no autorizado) no ve ninguno', [], v[2]);
    Check('CB3 sin respuesta de admin_sesion: ninguno', [], v[3]);
    Check('CB3 MOD sin ser PO/SO no ve Solicitar ni Crear', [], v[4]);
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
    ['tipo_iniciativa', 'tipo_agrupado'].forEach(function (k) { b.capturar(k, 'Problem'); });
    b.capturar('estado', 'En Análisis');
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

// MD) Edicion directa desde el registro (y "Crear > existente"): valores
//     cargados en su lugar, vista previa en vivo, legado conservado, nada
//     se guarda, solo ADM.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro, pg = p.pagina, preguntas = 0;
    reg.confirmar = function () { preguntas++; return true; };
    // Iniciativa con datos heredados: titulo de la iniciativa distinto del
    // del Problem y un % con dos decimales.
    reg.registro.iniciativas.push(Ini('PRB 2026-000009', { titulo: 'Titulo de la iniciativa (Excel)', titulo_problem: 'Titulo del Problem',
      categorias: [Cat('/A/Cat 1', 0.3333)] }));

    pg.fijarRol('MOD');
    Check('MD1 MOD: modificar no abre edicion; el detalle de MOD no tiene controles ni barra', [false, null, false, false],
      [reg.modificar('PRB 2026-000001'), reg.edicion, /data-edicion/.test(p.sel('regDetCuerpo').innerHTML),
       /id="regEdBarra"/.test(p.sel('regDetCuerpo').innerHTML)]);
    reg.abrirDetalle('PRB 2026-000001');
    Check('MD1b MOD: el detalle sigue de solo lectura', [null, false],
      [reg.edicion, /data-edicion/.test(p.sel('regDetCuerpo').innerHTML)]);
    reg.cerrarDetalle();
    pg.fijarRol('ADM');

    Check('MD2 ADM: abre el detalle ya editable, sin cambios ni barra', [true, 'PRB 2026-000001', 0, true],
      [reg.modificar('PRB 2026-000001'), reg.abierta, reg.edicion.cambios().length, p.sel('regEdBarra').hidden]);
    var ed = reg.edicion, html = p.sel('regDetCuerpo').innerHTML;
    Check('MD2 valores actuales cargados', ['T PRB 2026-000001', 'Desc PRB 2026-000001', 'Obs PRB 2026-000001', ['50', '25']],
      [ed.valores.titulo, ed.valores.descripcion, ed.valores.observaciones, ed.valores.pct.map(function (x) { return x.valor; })]);
    Check('MD2 ... y a la vista en su lugar (titulo en el encabezado, textos, %)', [true, true, true],
      [/data-editar="titulo"[^>]*>T PRB 2026-000001<\/div>/.test(html), /data-editar="descripcion"[^>]*>Desc PRB 2026-000001<\/div>/.test(html),
       /data-edicion-pct="1" value="25"/.test(html)]);
    Check('MD3 "Crear > existente" NO abre editores: el titulo se ve como texto y recibe el foco', [false, null, true, false],
      [/id="regEd-titulo"/.test(p.sel('regDetCuerpo').innerHTML), reg.editando,
       p.sel('regEdVer-titulo').enfocado > 0, /<textarea/.test(p.sel('regDetCuerpo').innerHTML)]);
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
    Check('MD6b con cambios sin guardar, abrir otra pregunta antes', 1, preguntas);
    html = p.sel('regDetCuerpo').innerHTML;
    Check('MD7 legado: titulo editable = el del Problem; % 33.33 sin redondeos; sin cambios al abrir',
      ['Titulo del Problem', '33.33', 0], [reg.edicion.valores.titulo, reg.edicion.valores.pct[0].valor, reg.edicion.cambios().length]);
    Check('MD7 encabezado = TituloIniciativa (sin editor); el del Problem va en "Título del problema"; el aviso dice que el del Excel se conserva',
      [true, false, true, true],
      [/<p class="ini-det-nombre">Titulo de la iniciativa \(Excel\)<\/p>/.test(html), /id="regDetNombre"><div class="ini-ed-caja"/.test(html),
       /<dt>Título del problema<\/dt><dd><div class="ini-ed-caja" id="regEdCaja-titulo"><div [^>]*data-editar="titulo"[^>]*>Titulo del Problem<\/div>/.test(html),
       /ProblemCategoria\.TituloIniciativa/.test(p.sel('regEdVista').innerHTML)]);

    reg.modificar('MAP 2026-000003');
    Check('MD8 faltaba un %: la marca Incompleta del detalle lo dice', true,
      /Incompleta<\/strong> · faltan: % Disminución/.test(p.sel('regDetCuerpo').innerHTML));
    editar(p, 'data-edicion-pct', '0', '20');
    Check('MD8 capturarlo: "Se completaría" en la vista previa', true, /Se completaría: % Disminución/.test(p.sel('regEdVista').innerHTML));

    reg.modificar('PRB 2026-000002');
    html = p.sel('regDetCuerpo').innerHTML;
    Check('MD9 sin categoria: dueños del Problem se conservan; sin categorias todavia; Categoria ya faltaba', [true, true, true],
      [/OwnerProblem, OwnerServicio, Direccion\) y se conservan/.test(p.sel('regEdVista').innerHTML), /Sin categorías todavía/.test(html),
       /Incompleta<\/strong> · faltan: Categoría\./.test(html)]);

    p.sel('btnCrearAdmin').disparar('click');
    Check('MD10 ADM: la creacion directa sigue abriendo', 'crear', pg.vista);
    pg.fijarRol('MOD');
    Check('MD10 MOD: la creacion directa no', 'iniciativas', pg.vista);
    Check('MD11 solo lecturas GET, ninguna escritura', true, p.pedidos.every(function (x) { return x.metodo === 'GET'; }));
  });
});

// TX) Titulo, Descripcion y Observaciones de ADM: se VEN con su valor (el
//     titulo como encabezado) y se editan en su lugar con un clic. Vacio o
//     null se rotula; CRLF y saltos al inicio no cuentan como cambio; solo
//     lo cambiado viaja; Cancelar y guardar dejan lo guardado a la vista.
function textoMostrado(html, clave) {
  var m = new RegExp('data-editar="' + clave + '"[^>]*>([\\s\\S]*?)</div>').exec(html || '');
  return m ? m[1] : null;
}
pruebas.push(function () {
  var p = Pagina(), reg, srv;
  return esperar().then(function () {
    reg = p.registro;
    reg.registro.persistenciaAdmin = true;
    reg.registro.iniciativas.push(
      Ini('PRB 2026-000010', { descripcion: 'Línea 1\r\nLínea 2\r\n\r\nLínea 4', observaciones: '\nEmpieza con salto' }),
      Ini('PRB 2026-000011', { descripcion: null, observaciones: '' }),
      Ini('PRB 2026-000012', { titulo: 'Titulo visible (iniciativa)', titulo_problem: null }));

    // MOD: los textos se ven, sin nada que editar.
    p.pagina.fijarRol('MOD');
    reg.abrirDetalle('PRB 2026-000010');
    var mod = p.sel('regDetCuerpo').innerHTML;
    Check('TX1 MOD: titulo como encabezado, textos con su valor y sin editores', [true, true, false, false],
      [/<p class="ini-det-nombre">T PRB 2026-000010<\/p>/.test(mod), /<div class="ini-texto">Línea 1\r\nLínea 2/.test(mod),
       /data-editar|data-edicion=/.test(mod), /<textarea|<input type="text"/.test(mod)]);
    reg.cerrarDetalle();

    p.pagina.fijarRol('ADM');
    reg.abrirDetalle('PRB 2026-000010');
    var html = p.sel('regDetCuerpo').innerHTML;
    Check('TX2 ADM: titulo actual como encabezado (no un campo vacio); textos con su valor, multilinea intacto',
      ['T PRB 2026-000010', 'Línea 1\nLínea 2\n\nLínea 4', '\nEmpieza con salto', false],
      [textoMostrado(html, 'titulo'), textoMostrado(html, 'descripcion'), textoMostrado(html, 'observaciones'),
       /<input type="text" id="regEd-titulo"|<textarea/.test(html)]);
    Check('TX2b CRLF de la base y salto inicial: el borrador no ve cambios', [0, true],
      [reg.edicion.cambios().length, p.sel('regEdBarra').hidden]);

    // Clic en la descripcion: editor con el valor; el \n extra lo come el parser.
    var vista = Elemento('vista');
    vista.setAttribute('data-editar', 'descripcion');
    p.sel('regDetCuerpo').disparar('click', { target: vista });
    var caja = p.sel('regEdCaja-descripcion').innerHTML;
    Check('TX3 clic: la descripcion se vuelve textarea con su valor, en su lugar, con foco', ['descripcion', true, true],
      [reg.editando, /<textarea id="regEd-descripcion" data-edicion="descripcion"[^>]*>\nLínea 1\nLínea 2\n\nLínea 4<\/textarea>/.test(caja),
       p.sel('regEd-descripcion').enfocado > 0]);
    editar(p, 'data-edicion', 'descripcion', 'Descripción nueva\ncon dos líneas');
    var ctl = Elemento('control');
    ctl.setAttribute('data-edicion', 'descripcion');
    p.sel('regDetCuerpo').disparar('focusout', { target: ctl });
    caja = p.sel('regEdCaja-descripcion').innerHTML;
    Check('TX4 al salir vuelve a verse como texto, con lo escrito y marcado; la barra cuenta el cambio',
      [null, 'Descripción nueva\ncon dos líneas', true, '1 cambio sin guardar'],
      [reg.editando, textoMostrado(caja, 'descripcion'), /ini-ed-mostrar ini-texto ini-ed-cambiado/.test(caja), p.sel('regEdSucio').textContent]);

    // Enter sobre el titulo mostrado lo abre; Escape solo sale del editor.
    var tit = Elemento('vista');
    tit.setAttribute('data-editar', 'titulo');
    p.sel('regDetCuerpo').disparar('keydown', { target: tit, key: 'Enter', preventDefault: function () {} });
    Check('TX5 Enter abre el titulo con su valor', [true, 'titulo'],
      [/<input type="text" id="regEd-titulo"[^>]*value="T PRB 2026-000010"/.test(p.sel('regEdCaja-titulo').innerHTML), reg.editando]);
    editar(p, 'data-edicion', 'titulo', 'Titulo nuevo');
    p.doc.disparar('keydown', { key: 'Escape' });
    Check('TX5b Escape: sale del editor (el detalle sigue abierto) y el encabezado muestra lo escrito', [null, 'PRB 2026-000010', 'Titulo nuevo'],
      [reg.editando, reg.abierta, textoMostrado(p.sel('regEdCaja-titulo').innerHTML, 'titulo')]);

    // Cancelar: todo vuelve a lo guardado, tambien en el encabezado.
    accion(p, 'edicion-cancelar');
    Check('TX6 Cancelar: titulo, descripcion y observaciones guardados a la vista; sin cambios',
      [0, 'T PRB 2026-000010', 'Línea 1\nLínea 2\n\nLínea 4', '\nEmpieza con salto'],
      [reg.edicion.cambios().length, textoMostrado(p.sel('regDetNombre').innerHTML, 'titulo'),
       textoMostrado(p.sel('regDetDesc').innerHTML, 'descripcion'), textoMostrado(p.sel('regDetDesc').innerHTML, 'observaciones')]);

    // Guardar: solo lo cambiado viaja, por accion=modificar.
    editar(p, 'data-edicion', 'titulo', 'Titulo guardado');
    editar(p, 'data-edicion', 'observaciones', 'Obs guardada');
    srv = Servidor(200, { accion: 'modificar', valida: true, guardada: true, codigo: 'PRB 2026-000010', cambios: [] });
    return reg.guardarEdicion(srv.pedir, function (url) {
      var json = JSON.parse(JSON.stringify(REGISTRO));
      json.iniciativas.push(Ini('PRB 2026-000010', { titulo: 'Titulo guardado', titulo_problem: 'Titulo guardado',
        descripcion: 'Línea 1\r\nLínea 2\r\n\r\nLínea 4', observaciones: 'Obs guardada' }));
      if (/registro/.test(url)) return Promise.resolve(Respuesta(200, json));
      return Promise.reject(new Error('peticion inesperada ' + url));
    });
  }).then(function (r) {
    Check('TX7 guardar envia solo titulo y observaciones (la descripcion intacta no viaja)',
      [[['accion', 'modificar'], ['folio', 'PRB 2026-000010'], ['titulo', 'Titulo guardado'], ['observaciones', 'Obs guardada']]],
      [srv.pedidos[0].campos]);
    Check('TX8 tras guardar: lo releido se ve como texto (encabezado y bloques), sin cambios pendientes',
      ['guardada', 'Titulo guardado', 'Línea 1\nLínea 2\n\nLínea 4', 'Obs guardada', 0],
      [r.estado, textoMostrado(p.sel('regDetCuerpo').innerHTML, 'titulo'), textoMostrado(p.sel('regDetCuerpo').innerHTML, 'descripcion'),
       textoMostrado(p.sel('regDetCuerpo').innerHTML, 'observaciones'), reg.edicion.cambios().length]);

    // null / vacio: se rotulan y nunca viajan como cadena vacia.
    reg.registro.iniciativas.push(Ini('PRB 2026-000011', { descripcion: null, observaciones: '' }),
      Ini('PRB 2026-000012', { titulo: 'Titulo visible (iniciativa)', titulo_problem: null }));
    reg.abrirDetalle('PRB 2026-000011');
    var html = p.sel('regDetCuerpo').innerHTML;
    Check('TX9 descripcion null y observaciones vacias: "Sin captura." (no un campo en blanco), sin cambios',
      ['<span class="ini-nota">Sin captura.</span>', '<span class="ini-nota">Sin captura.</span>', '', '', 0],
      [textoMostrado(html, 'descripcion'), textoMostrado(html, 'observaciones'), reg.edicion.valores.descripcion,
       reg.edicion.valores.observaciones, reg.edicion.cambios().length]);
    reg.abrirDetalle('PRB 2026-000012');
    html = p.sel('regDetCuerpo').innerHTML;
    editar(p, 'data-edicion', 'f_cierre', '2027-01-31');
    Check('TX10 titulo del Problem null: el encabezado sigue con el titulo visible; el del Problem dice "Sin captura." y no viaja',
      [true, '<span class="ini-nota">Sin captura.</span>', ['f_cierre']],
      [/<p class="ini-det-nombre">Titulo visible \(iniciativa\)<\/p>/.test(html), textoMostrado(html, 'titulo'),
       reg.edicion.paraEnviar().slice(2).map(function (x) { return x[0]; })]);
  });
});

// OG) Guardar (relectura del registro) conserva el orden por columna, los
// filtros y la busqueda, y reacomoda la iniciativa guardada por su valor
// nuevo; sin orden elegido sigue el de f_creacion.
pruebas.push(function () {
  var p = Pagina(), reg, srv;
  function lista() {
    return (p.sel('regCuerpo').innerHTML.match(/<tr class="ini-fila" data-folio="[^"]+"/g) || [])
      .map(function (t) { return t.replace(/.*data-folio="/, '').replace('"', ''); });
  }
  function guardarTitulo(folio, titulo, fCreacion) {
    reg.abrirDetalle(folio);
    editar(p, 'data-edicion', 'titulo', titulo);
    srv = Servidor(200, { accion: 'modificar', valida: true, guardada: true, codigo: folio, cambios: [] });
    return reg.guardarEdicion(srv.pedir, function (url) {
      var json = JSON.parse(JSON.stringify(REGISTRO));
      json.iniciativas.forEach(function (i, n) {
        i.f_creacion = ['2026-01-10', '2026-02-10', '2026-03-10'][n];
        if (i.folio === folio) { i.titulo = titulo; i.titulo_problem = titulo; if (fCreacion) i.f_creacion = fCreacion; }
      });
      return Promise.resolve(Respuesta(200, json));
    });
  }
  return esperar().then(function () {
    reg = p.registro;
    reg.registro.persistenciaAdmin = true;
    p.pagina.fijarRol('ADM');
    reg.ordenarPor('titulo');
    elegir(p, 'regPo', 'PO 1');
    p.sel('regBuscar').value = '2026';
    reg.aplicarBusqueda();
    Check('OG1 antes: titulo asc, PO 1 y busqueda', ['MAP 2026-000003', 'PRB 2026-000001'], lista());
    return guardarTitulo('PRB 2026-000001', 'A primero');
  }).then(function (r) {
    Check('OG2 tras guardar: mismo orden, filtro y busqueda; la guardada sube por su titulo nuevo',
      ['guardada', { col: 'titulo', dir: 'asc' }, 'PO 1', '2026', ['PRB 2026-000001', 'MAP 2026-000003']],
      [r.estado, reg.orden, p.sel('regPo').value, reg.filtro.textoBuscado, lista()]);
    reg.cerrarDetalle();
    reg.ordenarPor('titulo'); reg.ordenarPor('titulo');         // desc -> por omision
    elegir(p, 'regPo', '');
    return guardarTitulo('PRB 2026-000001', 'Otro', '2026-12-01');
  }).then(function (r) {
    Check('OG3 sin orden elegido: tras guardar, por f_creacion (la guardada, ahora la mas reciente, al final)',
      ['guardada', null, ['PRB 2026-000002', 'MAP 2026-000003', 'PRB 2026-000001']], [r.estado, reg.orden, lista()]);
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
  Check('R1 PO y SO se eligen en Crear (caja + aviso de cada uno)', [true, true, true, true],
    [/id="admPoSelector"/.test(crear), /id="admSoSelector"/.test(crear), /id="admPoMsg"/.test(crear), /id="admSoMsg"/.test(crear)]);
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
      Check('R10 sin elegir, po/so viajan vacios (opcionales en el servidor)', [['po', ''], ['so', '']],
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
    elegir(p, 'admEstado', 'En Análisis');
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
    Check('G13b viajan Clasificacion y Agrupacion (del Tipo), Estado y entrega (hoy)', ['Adopción', 'Adopción', 'En Análisis', A.FECHAS_GESTION.hoy()],
      [campos.tipo_iniciativa, campos.tipo_agrupado, campos.estado, campos.f_entrega_analisis]);
    Check('G14 501: aviso, faltantes del servidor, nunca ok', ['no_habilitada', true, false, true, true],
      [r.estado, caja.classList.contains('aviso'), caja.classList.contains('ok'), /Incompleta/.test(caja.innerHTML), /No se guardó/.test(caja.innerHTML)]);
    Check('G15 Guardar se reactiva', false, p.sel('admGuardar').disabled);
  });
});

// ---------------------------------------------------------------------------
// DQ) PO / SO capturados y quitar en la edicion directa (sql/24). Codigo
//     nunca es editable ni viaja.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var ini = Ini('PRB 2026-000009', { po: 'PO de la categoria', so: 'SO de la categoria',
    po_capturado: 'PO 1', so_capturado: null, categorias: [Cat('/A/Cat 1', 0.5), Cat('/A/Cat 2', 0.1)] });
  var op = { rutas: ['/A/Cat 1', '/A/Cat 2', '/B/Cat 4'], pos: ['PO 1', 'PO 2'], sos: ['SO x', 'SO y'] };
  var off = new A.EdicionAdmin(ini, op);
  Check('DQ1 sin sql/24: PO / SO sin control; original = los CAPTURADOS', ['', '', 'PO 1', ''],
    [A.htmlControlEdicion(off, 'po'), A.htmlControlEdicion(off, 'so'), off.original.po, off.original.so]);
  off.capturar('po', 'PO 2');
  Check('DQ2 sin sql/24: un PO cambiado (a mano) no se envia: error local', [false, true],
    [off.revisar().listo, off.erroresFormato().some(function (e) { return e.clave === 'po' && /sql\/24/.test(e.mensaje); })]);
  Check('DQ3 sin sql/24: el texto de quitar dice que todavia no se guarda', true,
    /Quitar una categoría ligada todavía no se guarda: falta aplicar sql\/24/.test(A.htmlCategoriasEdicion(off, null)));
  var hOff = A.htmlCategoriasEdicion(off, null);
  Check('DQ3b sin sql/24: Quitar de una ligada sale deshabilitado (sin data-edicion-cat="quitar")', [false, 2],
    [/data-edicion-cat="quitar"/.test(hOff), (hOff.match(/<button type="button" class="btn linea chico" disabled title="Quitar/g) || []).length]);
  off.capturar('po', 'PO 1');
  off.categorias.quitar(1);
  Check('DQ3c sin sql/24: una ligada marcada para quitar (a mano) bloquea el envio con aviso; Restaurar lo libera', [false, true, true],
    [off.revisar().listo, off.erroresFormato().some(function (e) { return e.clave === 'quitar_categoria' && /sql\/24/.test(e.mensaje) && /Restaurar/.test(e.mensaje); }),
     (off.categorias.restaurar(1), !off.erroresFormato().some(function (e) { return e.clave === 'quitar_categoria'; }))]);
  var onQ = new A.EdicionAdmin(ini, Object.assign({ duenosYQuitar: true }, op));
  onQ.categorias.quitar(1);
  Check('DQ3d con sql/24: Quitar habilitado y sin bloqueo local', [true, false],
    [/data-edicion-cat="quitar"/.test(A.htmlCategoriasEdicion(onQ, null)), onQ.erroresFormato().some(function (e) { return e.clave === 'quitar_categoria'; })]);

  var on = new A.EdicionAdmin(ini, Object.assign({ duenosYQuitar: true }, op));
  Check('DQ4 con sql/24: control de lista para PO y SO con el capturado', [true, true],
    [/id="regEd-po"/.test(A.htmlControlEdicion(on, 'po')), /id="regEd-so"/.test(A.htmlControlEdicion(on, 'so'))]);
  on.capturar('po', ' PO 2 ');
  on.capturar('so', 'SO y');
  on.capturar('titulo', 'Titulo nuevo');
  Check('DQ5 PO, SO y Titulo viajan juntos (recortados), solo lo que cambio', [true,
      [['accion', 'modificar'], ['folio', 'PRB 2026-000009'], ['titulo', 'Titulo nuevo'], ['po', 'PO 2'], ['so', 'SO y']]],
    [on.revisar().listo, on.paraEnviar()]);
  Check('DQ6 cambio rotulado como capturado; nota: los de la categoria no cambian', ['Product Owner capturado', true],
    [on.cambios().filter(function (c) { return c.clave === 'po'; })[0].rotulo,
     on.notasLegado().some(function (n) { return /dueños de sus categorías/.test(n); })]);
  on.capturar('po', 'Alguien Inventado');
  Check('DQ7 PO fuera de la lista: error local', true, on.erroresFormato().some(function (e) { return e.clave === 'po'; }));
  on.capturar('po', '');
  Check('DQ8 vaciar el PO: permitido (viaja vacio)', [true, true],
    [on.revisar().listo, on.paraEnviar().some(function (x) { return x[0] === 'po' && x[1] === ''; })]);
  on.capturar('po', 'PO 1');
  Check('DQ9 volver al capturado: ya no es cambio', false, on.cambios().some(function (c) { return c.clave === 'po'; }));
  on.capturar('codigo', 'PRB 2026-999999');
  Check('DQ10 Codigo: capturar no lo toma, sin control, nunca viaja', ['', false, undefined],
    [A.htmlControlEdicion(on, 'codigo'), on.paraEnviar().some(function (x) { return x[0] === 'codigo'; }), on.valores.codigo]);
  Check('DQ11 el folio que viaja es el de la iniciativa abierta', 'PRB 2026-000009',
    on.paraEnviar().filter(function (x) { return x[0] === 'folio'; })[0][1]);
  Check('DQ12 con sql/24: el texto de quitar dice solo asociacion, sin aviso de no guardado', [true, false],
    [/solo la asociación/.test(A.htmlCategoriasEdicion(on, null)), /todavía no se guarda/.test(A.htmlCategoriasEdicion(on, null))]);

  // PO y SO independientes (sin cascada): cambiar uno nunca toca el otro.
  var ambos = Ini('PRB 2026-000010', { po_capturado: 'PO 1', so_capturado: 'SO x', categorias: [Cat('/A/Cat 1', 0.5)] });
  var soloPo = new A.EdicionAdmin(ambos, Object.assign({ duenosYQuitar: true }, op));
  soloPo.capturar('po', 'PO 2');
  Check('DQ13 solo PO: viaja po, NO so; el SO del borrador sigue siendo el capturado', [true, [['accion', 'modificar'], ['folio', 'PRB 2026-000010'], ['po', 'PO 2']], 'SO x'],
    [soloPo.revisar().listo, soloPo.paraEnviar(), soloPo.valores.so]);
  var soloSo = new A.EdicionAdmin(ambos, Object.assign({ duenosYQuitar: true }, op));
  soloSo.capturar('so', 'SO y');
  Check('DQ14 solo SO: viaja so, NO po; el PO sigue siendo el capturado', [[['accion', 'modificar'], ['folio', 'PRB 2026-000010'], ['so', 'SO y']], 'PO 1'],
    [soloSo.paraEnviar(), soloSo.valores.po]);
  var otro = new A.EdicionAdmin(ambos, Object.assign({ duenosYQuitar: true }, op));
  otro.capturar('titulo', 'Solo el titulo');
  Check('DQ15 editar otro campo: PO y SO no viajan (se conservan)', [['accion', 'modificar'], ['folio', 'PRB 2026-000010'], ['titulo', 'Solo el titulo']],
    otro.paraEnviar());
  // Un capturado que ya no esta en el catalogo: se muestra elegido (no se
  // vacia el control) y no es error mientras no se cambie.
  var fuera = new A.EdicionAdmin(Ini('PRB 2026-000011', { po_capturado: 'PO dado de baja', so_capturado: 'SO x', categorias: [] }),
    Object.assign({ duenosYQuitar: true }, op));
  fuera.capturar('so', 'SO y');
  Check('DQ16 PO capturado fuera del catalogo: el control lo trae elegido; cambiar el SO no lo toca ni da error',
    [true, true, [['accion', 'modificar'], ['folio', 'PRB 2026-000011'], ['so', 'SO y']]],
    [/PO dado de baja/.test(A.htmlControlEdicion(fuera, 'po')), fuera.revisar().listo, fuera.paraEnviar()]);
});

// ---------------------------------------------------------------------------
// FP) Fechas propias, agrupacion por declarar y tipos por categoria (sql/18)
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var ini = Ini('PRB 2026-000009', { f_analisis: '2026-10-28', categorias: [
    Cat('/A/Cat 1', 0.5),                                                         // inicial: hereda
    Cat('/A/Cat 2', 0.1, { f_analisis_propia: '2026-11-17', f_creacion_propia: '2026-11-02' }),  // ligada despues
    Cat('/B/Cat 4', 0.2, { agrup: null })                                         // sin agrupacion (Excel)
  ] });
  var ed = new A.EdicionAdmin(ini, { rutas: ['/A/Cat 1', '/A/Cat 2', '/B/Cat 4', '/B/Cat 5'],
    tiposIniciativa: ['Mejora', 'Problem'], tiposAgrupado: ['Adopcion', 'Problem'] });
  var html = A.htmlCategoriasEdicion(ed, null);
  Check('FP1 inicial: la de la iniciativa, sin input; ligada despues: input de fecha con la propia', [true, true, 1],
    [/28\/10\/2026<\/span> <span class="ini-origen derivado"[^>]*>De la iniciativa/.test(html),
     /<input type="date" data-edicion-fcat="1" value="2026-11-17">/.test(html), (html.match(/data-edicion-fcat=/g) || []).length]);
  Check('FP2 la inicial no acepta fecha propia (cambia con la de la iniciativa)', [false, true],
    [ed.capturarFechaCategoria(0, '2026-12-01'), ed.capturarFechaCategoria(1, '2026-11-30')]);
  Check('FP3 la fecha propia editada viaja como fcat_*; la de la iniciativa no se toca', [[['fcat_categoria', '/A/Cat 2'], ['fcat_analisis', '2026-11-30']], false],
    [ed.paraEnviar().filter(function (x) { return /^fcat_/.test(x[0]); }), ed.paraEnviar().some(function (x) { return x[0] === 'f_analisis'; })]);
  Check('FP4 cambio en la vista previa con el anterior crudo', true,
    ed.cambios().some(function (c) { return c.clave === 'fechas_categoria' && c.anterior === '2026-11-17' && c.nuevo === '2026-11-30'; }));
  ed.capturarFechaCategoria(1, '');
  Check('FP5 vaciar la fecha propia bloquea', true, ed.erroresFormato().some(function (e) { return e.clave === 'fechas_categoria'; }));
  ed.capturarFechaCategoria(1, '2026-11-17');
  Check('FP6 sin agrupacion: selector para declararla; las que la tienen la muestran', [true, true],
    [/data-edicion-tipo="2\|tipo_agrupado"/.test(html), /Sin declarar/.test(html)]);
  Check('FP7 declarar la agrupacion de una ligada viaja con su % actual (lista paralela)', [true,
      [['pct_categoria', '/B/Cat 4'], ['pct_valor', '20'], ['pct_tipo_agrupado', 'Adopcion']]],
    [ed.capturarTipo(2, 'tipo_agrupado', 'Adopcion'), ed.paraEnviar().filter(function (x) { return /^pct_/.test(x[0]); })]);
  Check('FP8 a una ligada con agrupacion no se le cambia aqui', false, ed.capturarTipo(0, 'tipo_agrupado', 'Adopcion'));
  ed.categorias.agregar('/B/Cat 5');
  Check('FP9 una nueva sin Clasificacion ni Agrupacion no bloquea y no los copia de las hermanas', [0, '', ''],
    [ed.erroresFormato().filter(function (e) { return e.clave === 'categorias'; }).length,
     ed.categorias.filas[3].tipoIniciativa, ed.categorias.filas[3].tipoAgrupado]);
  ed.capturarTipo(3, 'tipo_iniciativa', 'Mejora');
  ed.capturarTipo(3, 'tipo_agrupado', 'Problem');
  Check('FP10 con sus tipos: lista, y viajan en paralelo a agregar_*', [true, [['agregar_categoria', '/B/Cat 5'], ['agregar_pct', ''],
      ['agregar_tipo_iniciativa', 'Mejora'], ['agregar_tipo_agrupado', 'Problem']]],
    [ed.revisar().listo, ed.paraEnviar().filter(function (x) { return /^agregar_/.test(x[0]); })]);
  html = A.htmlCategoriasEdicion(ed, null);
  Check('FP11 la nueva pinta Clasificacion y Agrupacion elegidas', [true, true],
    [/data-edicion-tipo="3\|tipo_iniciativa"><option value="">— Clasificación —<\/option><option value="Mejora" selected>/.test(html),
     /data-edicion-tipo="3\|tipo_agrupado"><option value="">— Agrupación —<\/option><option value="Adopcion">Adopcion<\/option><option value="Problem" selected>/.test(html)]);
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
    ['tipo_iniciativa', 'tipo_agrupado'].forEach(function (k) { p.pagina.crearAdmin.borrador.capturar(k, 'Problem'); });
    p.pagina.crearAdmin.borrador.capturar('estado', 'En Análisis');
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
    Check('G23 Crear 200 "guardada" sin accion ni codigo: no se acepta como exito', ['error', false, false, false],
      [r.estado, r.guardada, caja.classList.contains('ok'), exito.test(caja.innerHTML)]);
  });
});

// GS10) Modificar GUARDADO: recarga el registro (lista, categorias, capacidad
// e historial salen de ahi) y reabre el detalle con el aviso; un 409 no
// recarga nada y deja la edicion abierta.
pruebas.push(function () {
  var p = Pagina(), reg;
  function registros() { return p.pedidos.filter(function (x) { return /registro/.test(x.url); }).length; }
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    reg.modificar('PRB 2026-000001');
    Check('GS10a con persistencia activa el boton dice "Guardar cambios" y no hay aviso de solo validar', [true, false],
      [/data-accion="edicion-guardar"[^>]*>Guardar cambios<\/button>/.test(p.sel('regDetCuerpo').innerHTML),
       /no está habilitada/.test(p.sel('regDetCuerpo').innerHTML)]);
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    return reg.guardarEdicion(Servidor(409, { tipo: 'TopeExcedido', error: 'tope', guardada: false }).pedir);
  }).then(function (r) {
    Check('GS10b 409: rechazada, la edicion sigue abierta, sin recargar', ['rechazada', true, 1],
      [r.estado, !!reg.edicion, registros()]);
    return reg.guardarEdicion(Servidor(200, { accion: 'modificar', valida: true, guardada: true, codigo: 'PRB 2026-000001',
      cambios: [{ clave: 'titulo', rotulo: 'Título', anterior: 'x', nuevo: 'Nuevo' }] }).pedir);
  }).then(function (r) {
    var aviso = p.sel('regDetAviso');
    Check('GS10c guardado: recarga el registro una vez, reabre el mismo detalle (borrador nuevo, sin cambios) con el aviso', ['guardada', 2, 'PRB 2026-000001', 0, false, true],
      [r.estado, registros(), reg.abierta, reg.edicion.cambios().length, aviso.hidden, /Guardado en la base/.test(aviso.innerHTML)]);
  });
});

// GS) Persistencia ACTIVA: solo 200 + guardada + accion (+ codigo en un alta)
// es exito; 409 / 500 EscrituraNoConfirmada nunca dicen "guardado"; un alta
// guardada limpia el borrador y avisa a la pagina; Modificar guardado recarga
// el registro y reabre el detalle.
pruebas.push(function () {
  var R = base.ventana.IniciativaAdmin.RespuestaGestion;
  Check('GS1 estados con la persistencia activa', ['guardada', 'guardada', 'error', 'rechazada', 'rechazada', 'no_confirmada'], [
    R.desde(200, { accion: 'crear', valida: true, guardada: true, codigo: 'PRB 2026-000185' }).estado,
    R.desde(200, { accion: 'modificar', valida: true, guardada: true, codigo: 'PRB 2026-000001' }).estado,
    R.desde(200, { accion: 'crear', valida: true, guardada: true, codigo: '' }).estado,
    R.desde(409, { tipo: 'TopeExcedido', error: '/A/Cat 1: solo tiene 0%', guardada: false }).estado,
    R.desde(409, { tipo: 'PendienteSinRegla', error: 'No se guardó nada: quitar', guardada: false }).estado,
    R.desde(500, { tipo: 'EscrituraNoConfirmada', error: 'tiempo agotado', guardada: null }).estado
  ]);
  var g = R.desde(200, { accion: 'crear', valida: true, guardada: true, codigo: 'PRB 2026-000185', cambios: [] });
  var html = A.htmlRespuesta(g);
  Check('GS2 guardada: dice el codigo, clase ok, sin aviso de "no se guardo"', [true, 'ok', false, true],
    [/Guardado en la base · Código PRB 2026-000185/.test(html), A.claseRespuesta(g), /No se guardó/.test(html), g.guardada]);
  var rch = R.desde(409, { tipo: 'TopeExcedido', error: '/A/Cat 1: solo tiene 0% disponible', guardada: false });
  Check('GS3 rechazada: no se guardo, con el motivo de la base, nunca ok', [false, 'mal', true, true],
    [rch.guardada, A.claseRespuesta(rch), /No se guardó nada/.test(A.htmlRespuesta(rch)), /solo tiene 0% disponible/.test(A.htmlRespuesta(rch))]);
  var nc = R.desde(500, { tipo: 'EscrituraNoConfirmada', error: 'No se pudo confirmar el guardado', guardada: null });
  Check('GS4 no confirmada: no dice ni guardado ni "no se guardo"; pide revisar', [false, false, true, 'aviso'],
    [/Guardado en la base/.test(A.htmlRespuesta(nc)), /No se guardó nada/.test(A.htmlRespuesta(nc)),
     /Revisa el registro antes de reintentar/.test(A.htmlRespuesta(nc)), A.claseRespuesta(nc)]);
  Check('GS5 rotulos: sin el dato del servidor, "no guarda"; con persistencia, "Guardar"',
    ['Validar en el servidor (no guarda)', 'Guardar'], [A.ROTULOS.valida.boton, A.ROTULOS.guarda.boton]);

  var p = Pagina(), recargas = 0;
  return esperar().then(function () {
    var pg = p.pagina;
    pg.fijarRol('ADM');
    p.sel('tab-administracion').disparar('click');
    p.sel('btnCrearAdmin').disparar('click');
    Check('GS6 registro sin persistencia_admin: el boton de alta dice que no guarda', 'Validar en el servidor (no guarda)', p.sel('admGuardar').textContent);
    pg.registro.registro.persistenciaAdmin = true;
    pg.crearAdmin.pintar();
    Check('GS7 con persistencia_admin = true: "Guardar"', 'Guardar', p.sel('admGuardar').textContent);
    pg.crearAdmin.alGuardar = function () { recargas++; };
    elegir(p, 'admTipo', 'ADO');
    escribir(p, 'adm-titulo', 'Alta real');
    pg.crearAdmin.pedir = Servidor(409, { tipo: 'TopeExcedido', error: 'tope', guardada: false }).pedir;
    return pg.crearAdmin.guardar();
  }).then(function (r) {
    Check('GS8 alta rechazada: el borrador sigue (para corregir) y no se recarga nada', ['rechazada', 'Alta real', 0],
      [r.estado, p.pagina.crearAdmin.borrador.valores.titulo, recargas]);
    p.pagina.crearAdmin.pedir = Servidor(200, { accion: 'crear', valida: true, guardada: true, codigo: 'ADO 2026-000074', cambios: [] }).pedir;
    return p.pagina.crearAdmin.guardar();
  }).then(function (r) {
    var caja = p.sel('admResultado');
    Check('GS9 alta guardada: muestra el codigo, limpia el borrador y avisa a la pagina una vez', ['guardada', true, '', '', 1, true],
      [r.estado, /ADO 2026-000074/.test(caja.innerHTML), p.pagina.crearAdmin.borrador.tipo, p.pagina.crearAdmin.borrador.valores.titulo,
       recargas, caja.classList.contains('ok')]);
  });
});

// SL) Selector
pruebas.push(function () {
  var S = A.Selector, veinte = [], veintiuna = [];
  for (var n = 1; n <= 21; n++) { if (n <= 20) veinte.push('/R/' + n); veintiuna.push('/R/' + n); }
  Check('SL1 hasta 20 opciones: select', [true, false], [/^<select id="x"/.test(S.html('x', veinte, '')), /datalist/.test(S.html('x', veinte, ''))]);
  Check('SL2 21 opciones: el mismo <select> del desplegable de SLA, sin caja de texto ni datalist', [true, false, 22],
    [/^<select id="x" class="ini-dd-categoria">/.test(S.html('x', veintiuna, '')), /datalist|<input/.test(S.html('x', veintiuna, '')),
     (S.html('x', veintiuna, '').match(/<option /g) || []).length]);
  Check('SL2b un class de extra se suma a la marca (un solo atributo class)', [true, 1],
    [/^<select id="x" class="ini-dd-categoria ini-ed-campo mia" data-edicion="po">/.test(S.html('x', veinte, '', ' data-edicion="po" class="ini-ed-campo mia"')),
     (S.html('x', veinte, '', ' class="a"').match(/class=/g) || []).length]);
  Check('SL2c el valor actual queda elegido; uno que no es opcion no elige nada', [true, false],
    [/<option value="\/R\/21" selected>/.test(S.html('x', veintiuna, '/R/21')), / selected/.test(S.html('x', veintiuna, 'escrito a mano'))]);
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
    Check('CV5 volumetria: los ultimos 30 dias (ok y cero real) y error (nunca 0 si fallo)', [true, true, true, false],
      [/418 tickets \(últimos 30 días\)/.test(html), /0 tickets en los últimos 30 días/.test(html),
       /No se pudo consultar: error 53/.test(html), /ini-vol mal[^<]*>0 tickets/.test(html)]);
    Check('CV5b el total historico (5,000 y 74) no se pinta en la columna', [false, false, false],
      [/5,000|5000/.test(html), /74 tickets/.test(html), /total de la categoría/.test(html)]);
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
      /El registro no trajo el Subestado/.test(p.sel('regDetCuerpo').innerHTML));
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
      ['quitar_categoria', '/A/Cat 2'], ['agregar_categoria', '/B/Cat 4'], ['agregar_pct', ''],
      ['agregar_tipo_iniciativa', ''], ['agregar_tipo_agrupado', '']], pares);
    Check('ED9 el codigo nunca viaja como cambio', false, ed.cambios().some(function (c) { return c.clave === 'folio' || c.clave === 'codigo'; }));
    var res = Elemento('r'); res.setAttribute('data-edicion-cat', 'restaurar'); res.setAttribute('data-indice', '1');
    p.sel('regDetCuerpo').disparar('click', { target: res });
    Check('ED10 restaurar la quitada', false, ed.categorias.filas[1].quitada);
    Check('ED11 la agregada pide su volumetria (en curso o ya resuelta)', true, !!reg.volumetria.estado('/B/Cat 4'));
    Check('ED12 el registro no cambia', ['En Análisis', 2], [reg.registro.buscar('PRB 2026-000001').estado,
      reg.registro.buscar('PRB 2026-000001').categorias.length]);
 
    return esperar().then(esperar).then(function () {
      Check('ED13 ... y la pide al servidor por GET', true, p.pedidos.some(function (x) {
        return x.metodo === 'GET' && /volumetria\.ashx\?alcance=total&ruta=%2FB%2FCat%204/.test(x.url); }));
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
  b.capturar('tipo_iniciativa', 'Problem'); b.capturar('tipo_agrupado', 'Adopcion'); b.capturar('estado', 'En Análisis');
  b.agregarCategoria('/A/Cat 1'); b.agregarCategoria('/B/Cat 4');
  b.categorias.capturarPct(0, '20');
  var r = b.revisar();
  Check('AD2 con tipo y datos a medias: listo para validar, pero Incompleta', [true, true], [r.listo, r.incompleta]);
  Check('AD3 el faltante de % dice que categoria no lo tiene', true,
    r.faltantes.some(function (f) { return f.clave === 'pct' && /sin %: \/B\/Cat 4\)/.test(f.rotulo); }));
  Check('AD4 los campos vacios siguen vacios (no se rellenan)', ['', '', ''],
    [b.valores.titulo, b.valores.descripcion, b.valores.observaciones]);
  Check('AD5 viajan las dos categorias, la incompleta con % vacio', [['cat_ruta', '/A/Cat 1'], ['cat_pct', '20'], ['cat_ruta', '/B/Cat 4'], ['cat_pct', '']],
    b.paraEnviar().filter(function (c) { return /^cat_/.test(c[0]); }));
  Check('AD6 agregar otra no cambia el % ya escrito', [true, '20', ''],
    [b.agregarCategoria('/A/Cat 2').ok, b.categorias.filas[0].valor, b.categorias.filas[2].valor]);
  Check('AD7 duplicado rechazado', [false, 3], [b.agregarCategoria(' /a/cat 2').ok, b.categorias.filas.length]);
  Check('AD8 lo escrito que no es categoria: rechazo con parecidas, sin elegir', [false, true, 3],
    (function (x) { return [x.ok, /Parecidas: \/A\/Cat 1 · \/A\/Cat 2/.test(x.mensaje), b.categorias.filas.length]; })(b.agregarCategoria('cat')));
  Check('AD9 la revision local nunca guarda ni genera codigo', [true, null, false], [/No se guardó nada/.test(r.aviso), r.codigo, r.guardado]);
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
      [/Fecha de análisis<\/th>/.test(html), /01\/12\/2026<\/span> <span class="ini-origen derivado"[^>]*>De la iniciativa/.test(html),
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
    Check('LF11 nota del modelo: iniciales heredan la de la iniciativa; ligadas despues, la suya (+15)', true,
      /las categorías iniciales heredan la de la iniciativa y cambian con ella \(Fecha compromiso de Análisis\)\. Una categoría ligada después tiene la suya: el día en que se liga \+ 15 días/.test(p.sel('regEdCats').innerHTML));
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

// LA) Rutas de ADM en el registro: "Modificar" ofrece todas las activas
// (rutas_adm), "Solicitar cambios" sigue con las de la cascada.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.fijarRutasCatalogo(['/A/Cat 1', '/A/Cat 2'], undefined, ['/A/Cat 1', '/A/Cat 2', '/Z/Sin duenos']);
    reg.modificar('PRB 2026-000001');
    Check('LA1 Modificar: el selector trae la ruta sin duenos, como <select> del desplegable', [true, true, true],
      [reg.edicion.categorias.rutas.indexOf('/Z/Sin duenos') >= 0, /<select id="regEdCatBuscar" class="ini-dd-categoria"/.test(p.sel('regEdCats').innerHTML),
       /\/Z\/Sin duenos/.test(p.sel('regEdCats').innerHTML)]);
    Check('LA2 Modificar: agregar la ruta sin duenos se acepta', true, reg.agregarCategoriaEdicion('/Z/Sin duenos').ok);
    Check('LA3 Solicitar cambios: solo las de la cascada', ['/A/Cat 1', '/A/Cat 2'], reg.opcionesEstado().rutas);
    reg.fijarRutasCatalogo(['/A/Cat 1'], undefined, null);
    Check('LA4 sin rutas_adm (MOD / servidor viejo): Modificar usa las de la cascada', ['/A/Cat 1'], reg.edicion.categorias.rutas);
    reg.fijarRutasCatalogo(null, 'error', ['/Z/Sin duenos']);
    Check('LA5 con error de catalogo las de ADM no quedan colgadas', null, reg.rutasAdmCatalogo);
  });
});

// HUD) El mismo detalle para ADM, MOD y sin rol: valores guardados como
// texto al abrir (sin editores); edicion directa solo ADM; "Solicitar
// cambios" para ADM y MOD (el servidor lo exige), sin escrituras; sin rol,
// solo lectura.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    [['ADM', true], ['MOD', false], [null, false]].forEach(function (caso) {
      var rol = caso[0], adm = caso[1], n = rol || 'sin rol';
      p.pagina.fijarRol(rol);
      reg.abrirDetalle('PRB 2026-000001');
      var html = p.sel('regDetCuerpo').innerHTML;
      Check('HUD1 ' + n + ': titulo, descripcion y observaciones guardados se VEN como texto; ningun editor abierto', [true, true, true, false, null],
        [/>T PRB 2026-000001<\/(div|p)>/.test(html), />Desc PRB 2026-000001<\/div>/.test(html), />Obs PRB 2026-000001<\/div>/.test(html),
         /<textarea|id="regEd-titulo"/.test(html), reg.editando]);
      Check('HUD1 ' + n + ': las mismas tarjetas del detalle (Identificacion, Organizacion, Impacto, Seguimiento, Categorias, Historial)', true,
        ['regDetIdent', 'regDetEtapas', 'regDetCats', 'regDetDesc'].every(function (id) { return html.indexOf('id="' + id + '"') >= 0; }) &&
        /Organización/.test(html) && /Impacto/.test(html) && /Historial de cambios/.test(html));
      Check('HUD2 ' + n + ': edicion directa ' + (adm ? 'disponible' : 'ausente') + '; Solicitar cambios ' + (rol ? 'disponible' : 'ausente'),
        [adm, adm, adm ? 'Edición directa (ADM)' : 'Solo lectura', !!rol],
        [!!reg.edicion, /data-editar="titulo"|data-edicion=/.test(html), p.sel('regDetModo').textContent,
         /id="regCambioBoton" data-accion="solicitar-cambios"/.test(html)]);
      if (!rol) {
        accion(p, 'solicitar-cambios');
        Check('HUD3 sin rol: Solicitar cambios no abre nada', [false, false], [!!reg.cambioAbierto, /regCambioCampo/.test(p.sel('regCambio').innerHTML)]);
        reg.cerrarDetalle(true);
        return;
      }
      var antes = p.pedidos.length;
      accion(p, 'solicitar-cambios');
      elegir(p, 'regCambioCampo', 'fecha');
      elegir(p, 'regCambioFechaCampo', 'f_analisis');
      p.sel('regCambioNueva').value = '2027-02-01';
      p.sel('regCambioMotivo').value = 'Prueba ' + n;
      accion(p, 'cambio-agregar');
      accion(p, 'cambio-preparar');
      Check('HUD3 ' + n + ': la solicitud se prepara sin peticiones y sin tocar la iniciativa', [true, antes, '2026-12-01'],
        [/Solicitud preparada, no enviada/.test(p.sel('regCambioMsg').innerHTML), p.pedidos.length,
         reg.registro.buscar('PRB 2026-000001').f_analisis]);
      accion(p, 'cambio-cancelar');
      reg.cerrarDetalle(true);
    });
  });
});

// SC) Solicitar cambios: varias categorias en una solicitud (DOM). Solo
// se prepara: ni peticiones ni guardado.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    // Agregar solo va por el par capturado (2026-10-28): esta iniciativa,
    // con PO 3 / SO z, puede agregar /B/Cat 4.
    var ini = reg.registro.buscar('PRB 2026-000001'); ini.po_capturado = 'PO 3'; ini.so_capturado = 'SO z';
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
      [/\/B\/Cat 4<\/span>(<button[\s\S]*?<\/button>)?<\/span> <span class="ini-cat-estado nueva">Agregar/.test(grupo), /data-cambio-pct="1" value="30"/.test(grupo),
       /data-cambio-nueva-pct="0"/.test(grupo)]);
    Check('SC3 solo se repinta el bloque de categorias: motivo y formulario intactos', ['Se amplia el alcance', form],
      [p.sel('regCambioMotivo').value, p.sel('regCambio').innerHTML]);
    p.sel('regCambioCatBuscar').value = '/A/Cat 1';
    accion(p, 'cambio-cat-agregar');
    Check('SC4 una ligada no se puede agregar otra vez', [true, 1], [/ya es una categoría de esta iniciativa|no es una categoría del Product Owner y Service Owner de la iniciativa/.test(p.sel('regCambioCatMsg').textContent), reg.cambio.nuevas.length]);
    p.sel('regCambioCatBuscar').value = '/B/Cat 4';
    accion(p, 'cambio-cat-agregar');
    Check('SC4b ni una nueva dos veces', [true, 1], [/ya está en la lista para agregar/.test(p.sel('regCambioCatMsg').textContent), reg.cambio.nuevas.length]);
    accion(p, 'cambio-agregar');
    Check('SC5 nueva sin %: no se agrega', [true, true, 0], [/error/.test(p.sel('regCambioMsg').className),
      /\/B\/Cat 4: escribe un porcentaje/.test(p.sel('regCambioMsg').innerHTML), reg.lista.items.length]);
    editar(p, 'data-cambio-nueva-pct', '0', '10');
    accion(p, 'cambio-agregar');
    accion(p, 'cambio-preparar');
    var msg = p.sel('regCambioMsg').innerHTML;
    Check('SC6 preparada (no enviada) con las dos categorias', [true, true, true],
      [/Solicitud preparada, no enviada/.test(msg), /\/A\/Cat 2: 25% → 30%/.test(msg), /\/B\/Cat 4 \(agregar\): 10%/.test(msg)]);
    Check('SC7 sin peticiones al servidor; el registro no cambia', [antes, 0.25, 2],
      [p.pedidos.length, reg.registro.buscar('PRB 2026-000001').categorias[1].pct_dism, reg.registro.buscar('PRB 2026-000001').categorias.length]);
    var ed = Elemento('e'); ed.setAttribute('data-cambio-item', 'editar|0');
    p.sel('regDetCuerpo').disparar('click', { target: ed });
    Check('SC8 Editar las categorias: vuelven al formulario', [1, '30'], [reg.cambio.nuevas.length, reg.cambio.pcts['/A/Cat 2']]);
    var q = Elemento('q'); q.setAttribute('data-cambio-quitar', '0');
    p.sel('regDetCuerpo').disparar('click', { target: q });
    Check('SC8 quitar la agregada', [0, false], [reg.cambio.nuevas.length, /data-cambio-nueva-pct/.test(p.sel('regCambioGrupoPct').innerHTML)]);
    accion(p, 'cambio-edicion-cancelar');
    Check('SC8 Cancelar edicion: la lista queda como estaba', 1, reg.lista.items[0].nuevas.length);
    var qi = Elemento('qi'); qi.setAttribute('data-cambio-item', 'quitar|0');
    p.sel('regDetCuerpo').disparar('click', { target: qi });
    elegir(p, 'regCambioCampo', 'otros');
    p.sel('regCambioOtros').value = 'Elegi /A/Cat 2 por error';
    accion(p, 'cambio-agregar');
    accion(p, 'cambio-preparar');
    Check('SC9 Otros: solo explicacion, no cambia nada', [true, true],
      [/Solicitud preparada, no enviada/.test(p.sel('regCambioMsg').innerHTML), /no cambia nada por sí sola/.test(p.sel('regCambioMsg').innerHTML)]);
    Check('SC9b Otros aprobado no produce pares', null,
      new p.ventana.RegistroIniciativas.RevisionSolicitud(reg.lista.borrador(reg.lista.items[0]).resumen(), 'u').aprobar('a').pares);
  });
});

// SCC) Solicitar cambios: "Agregar categoria" por la cascada PO -> SO ->
// Categoria (CascadaOrganizacional, la de Nueva solicitud), sin DOM.
pruebas.push(function () {
  var R = base.ventana.RegistroIniciativas;
  var rutas = RUTAS.map(function (f) { return f.categoria; });
  function Nueva(po, so, filas) {
    return new R.SolicitudCambio(Ini('PRB 2026-000050', { po_capturado: po, so_capturado: so, categorias: [Cat('/A/Cat 1', 0.25)] }),
      { rutas: rutas, rutasEstado: 'ok', filas: filas === undefined ? RUTAS : filas });
  }
  // Regla (2026-10-28): SOLO el par PO / SO capturado de la iniciativa,
  // si existe en el catalogo; nada se elige de PO / SO y no se cae a otro par.
  var c = Nueva('PO 3', 'SO z');
  Check('SCC1 par capturado valido: fijo y con SUS categorias', [true, ['PO 3', 'SO z', ''], ['/B/Cat 4']],
    [c.cascada.parValido, c.cascada.seleccion.slice(), c.cascada.opciones(2)]);
  Check('SCC2 PO / SO no se eligen en la solicitud (no hay metodo para cambiarlos)', 'undefined', typeof c.elegirCascada);
  var r = c.agregarCategoria('/A/Cat 2');
  Check('SCC3 una categoria de OTRO par (aunque este en el catalogo) se rechaza con el par de la iniciativa', [false, true, 0],
    [r.ok, /no es una categoría del Product Owner y Service Owner de la iniciativa \(PO 3 \/ SO z\)/.test(r.mensaje), c.nuevas.length]);
  r = c.agregarCategoria('/b/cat 4');
  Check('SCC4 la del par se agrega; el par sigue fijo', [true, '/B/Cat 4', ['PO 3', 'SO z', '']],
    [r.ok, c.nuevas[0] && c.nuevas[0].categoria, c.cascada.seleccion.slice()]);
  var l = Nueva('PO 1', 'SO x');
  r = l.agregarCategoria('/A/Cat 1');
  Check('SCC5 la ligada sigue sin poder agregarse (y se conserva con su %)', [false, true, ['/A/Cat 1'], '25'],
    [r.ok, /ya es una categoría de esta iniciativa/.test(r.mensaje), l.categoriasLigadas(), l.pctActual('/A/Cat 1')]);
  [['PO 1', 'SO z', /no son un par del catálogo vigente/], ['PO X', 'SO x', /no son un par del catálogo vigente/],
   [null, null, /no tiene Product Owner y Service Owner capturados/], ['PO 1', null, /no tiene Product Owner y Service Owner capturados/]]
    .forEach(function (k) {
      var x = Nueva(k[0], k[1]), rr = x.agregarCategoria('/B/Cat 4');
      Check('SCC6 par capturado ' + k[0] + ' / ' + k[1] + ': no valido, nada se agrega y no se cae a otro par', [false, ['', '', ''], false, true, 0],
        [x.cascada.parValido, x.cascada.seleccion.slice(), rr.ok, k[2].test(rr.mensaje), x.nuevas.length]);
    });
  var plana = Nueva('PO 1', 'SO x', []);
  r = plana.agregarCategoria('/B/Cat 4');
  Check('SCC7 sin filas (catalogo sin cargar): sin lista plana, no se agrega', [null, false, 0], [plana.cascada, r.ok, plana.nuevas.length]);
  var f = Nueva('PO 3', 'SO z');
  f.fijarFilas(RUTAS.concat([{ director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 5' }]));
  Check('SCC8 el catalogo se recarga: mismo par, sus categorias nuevas', [['PO 3', 'SO z', ''], ['/B/Cat 4', '/B/Cat 5']],
    [f.cascada.seleccion.slice(), f.cascada.opciones(2)]);
  f.fijarFilas(RUTAS.slice(0, 2));
  Check('SCC8 ... si el par ya no esta en el catalogo, deja de ser valido', false, f.cascada.parValido);
  // Lo que viaja: agregar_categoria con la ruta del catalogo (el servidor la revisa, SolicitudesCambioHttpSmoke B11-B15).
  var e = Nueva('PO 3', 'SO z'); e.elegir('pct'); e.agregarCategoria('/B/Cat 4'); e.capturarPctNueva(0, '10'); e.motivo = 'm';
  Check('SCC12 el par que viaja es la ruta del catalogo con su %', true,
    JSON.stringify(e.pares()).indexOf('["agregar_categoria","/B/Cat 4"],["agregar_pct","10"]') >= 0);
});

// SCT) Solicitar cambios: % o Tickets por categoria. Viaja SIEMPRE el %
// (pct_valor / agregar_pct); los tickets se convierten con
// MetaCategoria.pct sobre la volumetria SLOT 0 de la ruta.
pruebas.push(function () {
  var R = base.ventana.RegistroIniciativas;
  function Nueva() {
    var c = new R.SolicitudCambio(Ini('PRB 2026-000060', { po_capturado: 'PO 3', so_capturado: 'SO z', categorias: [Cat('/A/Cat 1', 0.25)] }),
      { rutas: RUTAS.map(function (f) { return f.categoria; }), rutasEstado: 'ok', filas: RUTAS });
    c.elegir('pct'); c.motivo = 'm';
    return c;
  }
  function par(c, k) { var x = c.pares().filter(function (p) { return p[0] === k; }); return x.map(function (p) { return p[1]; }); }
  function errs(c) { return c.validar().map(function (e) { return e.mensaje; }); }

  var c = Nueva();
  c.fijarPct('/A/Cat 1', '30');
  Check('SCT1 en % todo sigue igual: viaja el % escrito', [['/A/Cat 1'], ['30'], []], [par(c, 'pct_categoria'), par(c, 'pct_valor'), errs(c)]);

  c = Nueva();
  c.agregarCategoria('/B/Cat 4');
  c.elegirModoMeta('/B/Cat 4', 'tickets');
  c.fijarVolumetria('/B/Cat 4', { estado: 'ok', valor: 7 });
  c.capturarTickets('/B/Cat 4', '3');
  var r = c.conversion('/B/Cat 4');
  Check('SCT2 3 tickets de 7: 42.86% exacto (FLOOR de 7 x 42.86% = 3)', ['42.86', true, 3], [r.pct, r.exacto, r.tickets]);
  Check('SCT2 viaja el % convertido, no los tickets', [['/B/Cat 4'], ['42.86'], false],
    [par(c, 'agregar_categoria'), par(c, 'agregar_pct'), JSON.stringify(c.pares()).indexOf('ticket') >= 0]);
  Check('SCT2 el % enviado es el que guarda la base (fraccion de 4 decimales: Math.Round(42.86/100, 4))', 0.4286,
    Math.round(Number(par(c, 'agregar_pct')[0]) / 100 * 10000) / 10000);
  Check('SCT2 la ida y vuelta da los tickets pedidos', 3, I.ticketsDe(7, par(c, 'agregar_pct')[0]));
  Check('SCT2 sin errores', [], errs(c));

  c.fijarVolumetria('/B/Cat 4', { estado: 'ok', valor: 100000 });
  c.capturarTickets('/B/Cat 4', '1');
  r = c.conversion('/B/Cat 4');
  Check('SCT3 1 ticket de 100,000: 0.01% da 10, se dice (exacto false), viaja 0.01', ['0.01', false, 10, ['0.01']],
    [r.pct, r.exacto, r.tickets, par(c, 'agregar_pct')]);

  var casos = [
    ['-1', { estado: 'ok', valor: 7 }, /número entero/], ['1.5', { estado: 'ok', valor: 7 }, /número entero/],
    ['x', { estado: 'ok', valor: 7 }, /número entero/], ['8', { estado: 'ok', valor: 7 }, /más que la volumetría/],
    ['1', { estado: 'cero', valor: 0 }, /volumetría 0/], ['1', { estado: 'error', valor: null }, /Sin volumetría/],
    ['1', { estado: 'sin_datos', valor: null }, /Sin volumetría/], ['1', { estado: 'cargando', valor: null }, /Calculando/]];
  casos.forEach(function (k) {
    var x = Nueva();
    x.agregarCategoria('/B/Cat 4'); x.elegirModoMeta('/B/Cat 4', 'tickets');
    x.fijarVolumetria('/B/Cat 4', k[1]); x.capturarTickets('/B/Cat 4', k[0]);
    var e = errs(x);
    Check('SCT4 tickets "' + k[0] + '" con volumetria ' + k[1].estado + ': error y ningun % sale', [true, ['']],
      [e.some(function (m) { return k[2].test(m); }), par(x, 'agregar_pct')]);
  });
  var sinVol = Nueva();
  sinVol.agregarCategoria('/B/Cat 4'); sinVol.elegirModoMeta('/B/Cat 4', 'tickets'); sinVol.capturarTickets('/B/Cat 4', '2');
  Check('SCT4 sin volumetria pedida todavia: error, no se envia', true, errs(sinVol).some(function (m) { return /Calculando|Sin volumetría/.test(m); }));
  var vacia = Nueva();
  vacia.agregarCategoria('/B/Cat 4'); vacia.elegirModoMeta('/B/Cat 4', 'tickets');
  Check('SCT4 nueva en tickets sin escribir: error propio', true, errs(vacia).some(function (m) { return /escribe los tickets a reducir/.test(m); }));

  var lig = Nueva();
  lig.elegirModoMeta('/A/Cat 1', 'tickets');
  lig.fijarVolumetria('/A/Cat 1', { estado: 'ok', valor: 418 });
  Check('SCT5 ligada en tickets sin escribir = sin cambio (y entonces falta algun cambio)', [[], true],
    [par(lig, 'pct_valor'), errs(lig).some(function (m) { return /al menos una categoría/.test(m); })]);
  lig.capturarTickets('/A/Cat 1', '100');
  Check('SCT5 ligada: 100 de 418 = 23.93% (FLOOR da 100)', [['23.93'], []], [par(lig, 'pct_valor'), errs(lig)]);
  lig.elegirModoMeta('/A/Cat 1', 'pct');
  Check('SCT6 volver a %: el % ya calculado se queda y se puede editar', ['23.93', 'pct'], [lig.pcts['/A/Cat 1'], lig.meta('/A/Cat 1').modo]);
  lig.fijarPct('/A/Cat 1', '20');
  Check('SCT6 ... en % manda lo escrito', ['20'], par(lig, 'pct_valor'));

  var L = new R.ListaSolicitudCambio(Ini('PRB 2026-000060', { po_capturado: 'PO 3', so_capturado: 'SO z', categorias: [Cat('/A/Cat 1', 0.25)] }),
    { rutas: RUTAS.map(function (f) { return f.categoria; }), rutasEstado: 'ok', filas: RUTAS });
  var item = R.ListaSolicitudCambio.desdeBorrador(c);
  var t = L.texto(item);
  Check('SCT7 el resumen dice que se pidio en tickets y con que volumetria (y que no da exacto)', true,
    /\/B\/Cat 4 \(agregar\): 0\.01% \(pedido como 1 ticket de una volumetría de 100000; con 2 decimales el % no da exacto\)/.test(t.linea));
  var vuelta = L.borrador(item);
  Check('SCT8 editar el cambio de la lista conserva el modo, los tickets y la volumetria', ['tickets', '1', 100000, '0.01'],
    [vuelta.meta('/B/Cat 4').modo, vuelta.meta('/B/Cat 4').tickets, vuelta.vols['/B/Cat 4'].valor, vuelta.nuevas[0].valor]);
  c.quitarNueva(0);
  Check('SCT9 quitar la nueva olvida su meta', undefined, c.metas['/B/Cat 4']);
});

// SCD) "Agregar categoria" pintado en el detalle: el par capturado a la vista
// (sin selectores de PO / SO) y solo sus categorias; sin par valido, el
// motivo y ningun selector.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro;
    p.pagina.fijarRol('MOD');
    reg.abrirDetalle('PRB 2026-000001');
    accion(p, 'solicitar-cambios');
    reg.cambio.elegir('pct'); reg.pintarCategoriasCambio();
    var g = p.sel('regCambioGrupoPct').innerHTML;
    Check('SCD1 par capturado (PO 1 / SO x) a la vista, sin selectores de PO / SO; solo sus categorias', [true, false, false, true, false, false],
      [/Solo categorías del Product Owner <b>PO 1<\/b> y el Service Owner <b>SO x<\/b> de la iniciativa/.test(g),
       /regCambioCascPo|regCambioCascSo/.test(g), /<option value="PO 3"/.test(g),
       /<option value="\/A\/Cat 1">/.test(g), /<option value="\/A\/Cat 2">/.test(g), /<option value="\/B\/Cat 4">/.test(g)]);
    var otra = reg.registro.buscar('PRB 2026-000001');
    var po = otra.po_capturado; otra.po_capturado = 'PO X';
    reg.cambio = new p.ventana.RegistroIniciativas.SolicitudCambio(otra, reg.opcionesEstado()); reg.cambio.elegir('pct'); reg.pintarCategoriasCambio();
    g = p.sel('regCambioGrupoPct').innerHTML;
    Check('SCD2 par que no esta en el catalogo: el motivo, sin selector de categoria ni boton Agregar', [true, false, false],
      [/\(PO X \/ SO x\) no son un par del catálogo vigente/.test(g), /id="regCambioCatBuscar"/.test(g), /cambio-cat-agregar/.test(g)]);
    otra.po_capturado = po;
    reg.cambio = new p.ventana.RegistroIniciativas.SolicitudCambio(otra, reg.opcionesEstado()); reg.cambio.elegir('pct'); reg.pintarCategoriasCambio();

    // % / Tickets de la ligada /A/Cat 1 (volumetria simulada: 418).
    g = p.sel('regCambioGrupoPct').innerHTML;
    Check('SCD4 cada categoria trae sus radios % de disminucion / Tickets a resolver, en % por omision; sin <select> de modo', [true, true, true, false],
      [/<input type="radio" name="regCambioModo-l0" value="pct" data-cambio-modo="l0" checked> % de disminución/.test(g),
       /<input type="radio" name="regCambioModo-l0" value="tickets" data-cambio-modo="l0"> Tickets a resolver/.test(g),
       /data-cambio-pct="0"/.test(g), /<select data-cambio-modo/.test(g)]);
    var antes = p.pedidos.length;
    var m = Elemento('m'); m.setAttribute('data-cambio-modo', 'l0'); m.value = 'tickets';
    p.sel('regDetCuerpo').disparar('change', { target: m });
    return esperar().then(function () {
      var url = String(p.pedidos.slice(antes).map(function (x) { return x.url || x; }).filter(function (u) { return /volumetria/.test(u); })[0] || '');
      Check('SCD5 Tickets pide la volumetria SLOT 0 de la ruta (sin alcance=total)', [true, false, true],
        [/admin_iniciativas_volumetria\.ashx/.test(url), /alcance=total/.test(url), /ruta=%2FA%2FCat%201/.test(url)]);
      g = p.sel('regCambioGrupoPct').innerHTML;
      Check('SCD6 en Tickets: la casilla de tickets, sin la del %, y la volumetria de hoy', [true, false, true, true],
        [/data-cambio-tickets="l0"/.test(g), /data-cambio-pct="0"/.test(g), /volumetría \(últimos 30 días\): 418/.test(g),
         /Pedido en tickets: se envía el %/.test(g)]);
      var tk = Elemento('t'); tk.setAttribute('data-cambio-tickets', 'l0'); tk.value = '100';
      var grupoAntes = p.sel('regCambioGrupoPct').innerHTML;
      p.sel('regDetCuerpo').disparar('input', { target: tk });
      Check('SCD7 escribir tickets solo cambia la pista de esa fila (la casilla no se repinta)', [true, grupoAntes, '23.93'],
        [/≈ 23\.93% · volumetría \(últimos 30 días\): 418/.test(p.sel('regCambioMeta-l0').innerHTML), p.sel('regCambioGrupoPct').innerHTML,
         reg.cambio.pcts['/A/Cat 1']]);
      tk.value = '999';
      p.sel('regDetCuerpo').disparar('input', { target: tk });
      Check('SCD7 mas tickets que la volumetria: error en la pista, sin %', [true, ''],
        [/class="ini-meta mal"[^>]*>[^<]*más que la volumetría/.test(p.sel('regCambioMeta-l0').innerHTML), reg.cambio.pcts['/A/Cat 1']]);
    });
  });
});

// SGF) Fechas por categoria en Seguimiento: la inicial (sin fechas propias,
// NULL en dbo.ProblemCategoria) muestra las de la INICIATIVA; la ligada
// despues, las suyas. Ningun "—" por la herencia.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var i = Ini('PRB 2026-000070', { f_analisis: '2026-10-28', f_solucion: '2026-12-01', f_cierre: null,
      categorias: [Cat('/A/Cat 1', 0.3), Cat('/A/Cat 2', 0.1)] });
    i.categorias[0].f_creacion_propia = null; i.categorias[0].f_analisis_propia = null;
    i.categorias[1].f_creacion_propia = '2026-11-02'; i.categorias[1].f_analisis_propia = '2026-11-17';
    var ini = p.registro.htmlSeguimientoCategoria(i, '/A/Cat 1'), lig = p.registro.htmlSeguimientoCategoria(i, '/A/Cat 2');
    Check('SGF1 inicial: Analisis = el de la iniciativa, marcado "De la iniciativa", y dice que hereda', [true, true, false],
      [/<dt>Análisis<\/dt><dd>28\/10\/2026 <span class="ini-origen derivado">De la iniciativa<\/span>/.test(ini),
       /Hereda las fechas de la iniciativa/.test(ini), /<dt>Análisis<\/dt><dd>—/.test(ini)]);
    Check('SGF2 ligada despues: su Analisis, "Propia", y el dia en que se ligo', [true, true],
      [/<dt>Análisis<\/dt><dd>17\/11\/2026 <span class="ini-origen">Propia<\/span>/.test(lig), /Se ligó el 02\/11\/2026/.test(lig)]);
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
        [/<select id="regSegCategoria" class="ini-dd-categoria">/.test(seg), /<option value="\/A\/Cat 1" selected>/.test(seg), /<option value="\/A\/Cat 2">/.test(seg)]);
      Check('SG4 bloque de la primera: su % y la fecha de analisis de la iniciativa (hereda)', [true, true, true],
        [/% disminución<\/dt><dd>50%/.test(seg), /De la iniciativa/.test(seg), /Hereda las fechas de la iniciativa/.test(seg)]);
      var cuerpo = p.sel('regDetCuerpo').innerHTML;
      p.sel('regBuscar').value = 'filtro escrito';
      function segElegir(v) { var t = p.sel('regSegCategoria'); t.value = v; p.sel('regDetCuerpo').disparar('change', { target: t }); }
      segElegir('/A/Cat 2');
      Check('SG5 cambiar de categoria repinta solo su bloque', [true, true, 'filtro escrito', '/A/Cat 2'],
        [/% disminución<\/dt><dd>25%/.test(p.sel('regSegCatInfo').innerHTML), p.sel('regDetCuerpo').innerHTML === cuerpo, p.sel('regBuscar').value, reg.segCategoria]);
      Check('SG6 sin fecha propia, la de analisis es la de la iniciativa (no se inventa)', [true, true],
        [/Análisis<\/dt><dd>01\/12\/2026/.test(p.sel('regSegCatInfo').innerHTML), /Hereda las fechas de la iniciativa/.test(p.sel('regSegCatInfo').innerHTML)]);
      segElegir('/Z/Inventada');
      Check('SG7 algo que no es categoria de la iniciativa: lo dice, no cambia la elegida', [true, '/A/Cat 2'],
        [/no es una categoría vigente/.test(p.sel('regSegCatInfo').innerHTML), reg.segCategoria]);
      reg.abrirDetalle('PRB 2026-000002');
      var sin = p.sel('regDetCuerpo').innerHTML;
      Check('SG8 sin categorias ni fecha de creacion: lo dice, sin inventar', [true, true],
        [/Sin categorías: las fechas son las del problema/.test(sin), /Fecha de creación<\/dt><dd>—/.test(sin)]);
      // Sin umbral: 20 o 21 categorias, siempre el <select> del desplegable.
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
          Check('SG9 sin umbral: 20 y 21 categorias son el <select> del desplegable, nunca <datalist>', [true, false, true, false],
            [/<select id="regSegCategoria" class="ini-dd-categoria">/.test(h20), /datalist|list="regSegCategoria-lista"/.test(h20),
             /<select id="regSegCategoria" class="ini-dd-categoria">/.test(h21), /datalist|list="regSegCategoria-lista"/.test(h21)]);
          var t = p.sel('regSegCategoria');
          t.value = '/R/21';
          p.sel('regDetCuerpo').disparar('change', { target: t });
          Check('SG10 elegir en el desplegable (change del <select>) fija la real', '/R/21', reg.segCategoria);
          t.value = '/R/no existe';
          p.sel('regDetCuerpo').disparar('change', { target: t });
          Check('SG10b un valor que no es opcion no cambia la categoria', '/R/21', reg.segCategoria);
        });
      });
    });
  });
});

// PS) Persistencia de Admin encendida (2026-10-14, tras sql/18 + ADM_04 en
//     la VM); el alta de categorias en Proactivanet sigue apagada.
pruebas.push(function () {
  Check('PS1 PersistenciaGestionAdmin.Habilitada = true', true,
    /class PersistenciaGestionAdmin[\s\S]*?public const bool Habilitada = true;/.test(leer('App_Code/GestionIniciativaAdmin.cs')));
  Check('PS2 AltaCategoriaProactivanet.Habilitada = false', true,
    /public const bool Habilitada = false;/.test(leer('App_Code/AltaCategoriaProactivanet.cs')));
  Check('PS3 ningun "true" para Habilitada del alta de categorias', false,
    /Habilitada\s*=\s*true/.test(leer('App_Code/AltaCategoriaProactivanet.cs')));
});

// DS) PO / SO en Crear: opcionales, de las listas del catalogo, sin la
//     cascada de Nueva solicitud y sin nombres escritos a mano.
//     Catalogo: PO 1/SO x/Cat 1, PO 1/SO y/Cat 2, PO 3/SO z/Cat 4.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var pg = p.pagina, v = pg.crearAdmin;
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    elegir(p, 'admTipo', 'ADO');
    var b = v.borrador;
    function viaja() {
      var o = {};
      b.paraEnviar().forEach(function (x) { if (x[0] === 'po' || x[0] === 'so' || x[0] === 'cat_ruta') o[x[0]] = x[1]; });
      return o;
    }
    function dueno(k, valor) { var c = p.sel(k === 'po' ? 'admPoSelector' : 'admSoSelector'); c.disparar('change', { target: { id: k === 'po' ? 'admPo' : 'admSo', value: valor } }); }

    Check('DS0 listas completas, sin filtrar (PO y SO distintos del catalogo)', [['PO 1', 'PO 3'], ['SO x', 'SO y', 'SO z']],
      [b.duenosLista.po, b.duenosLista.so]);
    Check('DS0 pocas opciones: <select> con todas', [true, 2, true, 3],
      [/<select id="admPo"/.test(p.sel('admPoSelector').innerHTML), (p.sel('admPoSelector').innerHTML.match(/<option value="PO/g) || []).length,
       /<select id="admSo"/.test(p.sel('admSoSelector').innerHTML), (p.sel('admSoSelector').innerHTML.match(/<option value="SO/g) || []).length]);

    Check('DS1 los tres vacios: listo, po/so vacios, sin categoria', [true, { po: '', so: '' }], [b.revisar().listo, viaja()]);
    dueno('po', 'PO 3');
    Check('DS2 solo PO: listo y viaja', [true, { po: 'PO 3', so: '' }], [b.revisar().listo, viaja()]);
    dueno('po', '');
    dueno('so', 'SO x');
    Check('DS3 solo SO: listo y viaja', [true, { po: '', so: 'SO x' }], [b.revisar().listo, viaja()]);
    dueno('so', '');
    v.agregarCategoria('/A/Cat 2');
    Check('DS4 solo categoria: listo y viaja', [true, { po: '', so: '', cat_ruta: '/A/Cat 2' }], [b.revisar().listo, viaja()]);
    b.categorias.quitar(0);

    v.agregarCategoria('/A/Cat 1');
    dueno('po', 'PO 1'); dueno('so', 'SO x');
    Check('DS5 los tres de una fila del catalogo', [true, { po: 'PO 1', so: 'SO x', cat_ruta: '/A/Cat 1' }], [b.revisar().listo, viaja()]);

    dueno('po', 'PO 3');
    Check('DS8 cambiar PO no vacia SO ni la categoria', { po: 'PO 3', so: 'SO x', cat_ruta: '/A/Cat 1' }, viaja());
    Check('DS7 combinacion que la cascada rechazaria (PO 3 + SO x + Cat 1): listo, sin aviso', [true, ''],
      [b.revisar().listo, p.sel('admPoMsg').textContent]);
    dueno('so', 'SO z');
    Check('DS9 cambiar SO no vacia PO ni la categoria', { po: 'PO 3', so: 'SO z', cat_ruta: '/A/Cat 1' }, viaja());
    Check('DS9 la lista de SO no se filtra por el PO', ['SO x', 'SO y', 'SO z'], b.duenosLista.so);
    Check('DS10 el Director sale de la categoria, no del PO', 'Dir A', p.sel('admDirector').textContent);

    dueno('po', '  po 1 ');
    Check('DS6 mayusculas y espacios de mas: elige la opcion real', 'PO 1', viaja().po);
    dueno('po', 'Juan Pérez');
    var r = b.revisar();
    Check('DS6 nombre escrito a mano: no se elige, bloquea y avisa con la lista', [false, '', false, true],
      [r.listo, viaja().po, r.formato.every(function (f) { return f.clave !== 'po'; }), /Elige un Product Owner de la lista/.test(p.sel('admPoMsg').textContent)]);
    Check('DS6 ... y no toca SO ni la categoria', { po: '', so: 'SO z', cat_ruta: '/A/Cat 1' }, viaja());
    dueno('po', '');
    Check('DS6 vaciarlo quita el aviso y vuelve a estar listo', [true, ''], [b.revisar().listo, p.sel('admPoMsg').textContent]);

    var srv = [];
    v.pedir = function (url, op) {
      var campos = []; op.body.forEach(function (val, k) { campos.push([k, val]); }); srv.push(campos);
      return Promise.resolve(RespuestaHttp(422, { valida: false, guardada: false, codigo: null,
        errores: [{ campo: 'so', mensaje: 'Service Owner: todavía no se guarda: el alta en la base no recibe Product Owner ni Service Owner.' }] }));
    };
    return v.guardar().then(function (g) {
      var caja = p.sel('admResultado');
      Check('DS12 base sin sql/20 (GuardaDuenos = false): 422, nunca "guardada", el aviso se ve', [1, 'invalida', false, true, true],
        [srv.length, g.estado, caja.classList.contains('ok'), /todavía no se guarda/.test(caja.innerHTML), v.borrador === b]);
      Check('DS12 viajo el SO elegido (no se descarto en el navegador)', true,
        srv[0].some(function (c) { return c[0] === 'so' && c[1] === 'SO z'; }));
    });
  });
});

// GS11-GS16) Modificar GUARDADO sin recargar la pagina: el registro se
// relee y se pinta con la MISMA vista (filtros, busqueda, orden, "mostrar
// mas", modo); el detalle se reabre con lo que devolvio el servidor. Los
// errores dejan la edicion abierta con lo escrito; un envio a la vez.
function RegistroGuardado(cambios) {
  var json = JSON.parse(JSON.stringify(REGISTRO));
  json.iniciativas.forEach(function (i) {
    if (i.folio === 'PRB 2026-000001') Object.keys(cambios).forEach(function (k) { i[k] = cambios[k]; });
  });
  return function (url) {
    if (/registro/.test(url)) return Promise.resolve(Respuesta(200, json));
    if (/catalogos/.test(url)) return Promise.resolve(Respuesta(200, CATALOGO));
    return Promise.reject(new Error('peticion inesperada ' + url));
  };
}
function Diferido() {
  var d = { pedidos: 0 };
  d.pedir = function () {
    d.pedidos++;
    return new Promise(function (ok) { d.responder = function (estado, json) { ok(RespuestaHttp(estado, json)); }; });
  };
  return d;
}
var GUARDADA = { accion: 'modificar', valida: true, guardada: true, codigo: 'PRB 2026-000001',
  cambios: [{ clave: 'titulo', rotulo: 'Título', anterior: 'T PRB 2026-000001', nuevo: 'Nuevo' }] };
// Filtros, busqueda, orden y "mostrar mas" puestos como los dejaria el
// usuario antes de abrir el detalle.
function vistaFiltrada(p, reg) {
  reg.filtro.elegirEstado('En Análisis');
  reg.filtro.elegirDirector('Dir A');
  p.sel('regBuscar').value = 'PRB';
  reg.aplicarBusqueda();
  reg.ordenarPor('folio');
  reg.limite = 200;
  reg.pintarTabla();
}
function vista(p, reg) {
  return [reg.filtro.estados.marcados, reg.filtro.director, reg.filtro.textoBuscado, p.sel('regBuscar').value,
          reg.orden, reg.limite, reg.modo];
}
var VISTA = [['En Análisis'], 'Dir A', 'PRB', 'PRB', { col: 'folio', dir: 'asc' }, 200, 'registro'];

pruebas.push(function () {
  var p = Pagina(), reg, recargas = 0, regAntes;
  return esperar().then(function () {
    reg = p.registro;
    p.ventana.location = { reload: function () { recargas++; }, assign: function () { recargas++; } };
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    vistaFiltrada(p, reg);
    regAntes = reg.registro;
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    return reg.guardarEdicion(Servidor(200, GUARDADA).pedir, RegistroGuardado({ titulo: 'Nuevo', titulo_problem: 'Nuevo' }));
  }).then(function (r) {
    var aviso = p.sel('regDetAviso');
    Check('GS11 guardado: sin recargar ni navegar; filtros, busqueda, orden, "mostrar mas" y modo intactos', ['guardada', 0, VISTA],
      [r.estado, recargas, vista(p, reg)]);
    Check('GS11 ... registro releido, mismo detalle abierto con lo guardado, borrador nuevo sin cambios, aviso de exito',
      [true, 'PRB 2026-000001', 'Nuevo', 0, true, false, true, true, false],
      [reg.registro !== regAntes, reg.abierta, reg.edicion.valores.titulo, reg.edicion.cambios().length, p.sel('regEdBarra').hidden, aviso.hidden, /Guardado en la base/.test(aviso.innerHTML),
       /Nuevo/.test(p.sel('regDetCuerpo').innerHTML), /ya no coincide/.test(aviso.innerHTML)]);
    Check('GS11 ... la lista muestra el titulo guardado (del servidor)', [true, 'Nuevo'],
      [/Nuevo/.test(p.sel('regCuerpo').innerHTML), reg.registro.buscar('PRB 2026-000001').titulo]);
    var fuentes = leer('admin/registro-iniciativas.js') + leer('admin/iniciativa-admin.js') + leer('admin/iniciativas.js');
    Check('GS11 ningun modulo de admin/ recarga ni navega la pagina', [false, false],
      [/location\.reload/.test(fuentes), /location\.(href\s*=|assign\(|replace\()/.test(fuentes)]);
  });
});

pruebas.push(function () {
  var p = Pagina(), reg;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    vistaFiltrada(p, reg);
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'estado', 'En Solución');
    return reg.guardarEdicion(Servidor(200, GUARDADA).pedir, RegistroGuardado({ estado: 'En Solución' }));
  }).then(function () {
    var aviso = p.sel('regDetAviso');
    Check('GS12 guardado que ya no pasa los filtros: filtros intactos, sale de la lista, el detalle sigue abierto y lo explica',
      [VISTA, false, 'PRB 2026-000001', true, true],
      [vista(p, reg), /PRB 2026-000001/.test(p.sel('regCuerpo').innerHTML), reg.abierta,
       /Guardado en la base/.test(aviso.innerHTML), /ya no coincide con los filtros/.test(aviso.innerHTML)]);
  });
});

pruebas.push(function () {
  var p = Pagina(), reg, regAntes, filtroAntes;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    vistaFiltrada(p, reg);
    regAntes = reg.registro; filtroAntes = reg.filtro;
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    return reg.guardarEdicion(Servidor(200, GUARDADA).pedir, function () { return Promise.resolve(Respuesta(500, { error: 'error 53' })); });
  }).then(function (r) {
    var aviso = p.sel('regDetAviso');
    Check('GS13 guardado pero la relectura falla: dice que SI se guardo y que la vista no se actualizo; la vista anterior intacta',
      ['guardada', true, true, true, true, true, VISTA],
      [r.estado, /Guardado en la base/.test(aviso.innerHTML), /no se pudo actualizar la vista: error 53/.test(aviso.innerHTML),
       /data-accion="recargar-guardado"/.test(aviso.innerHTML), reg.registro === regAntes, reg.filtro === filtroAntes, vista(p, reg)]);
    Check('GS13 ... el borrador guardado se suelta (sin cambios pendientes; lo que se ve puede estar viejo)', [0, false],
      [reg.edicion.cambios().length, reg.hayCambiosSinGuardar()]);
    accion(p, 'recargar-guardado');
    return esperar().then(esperar).then(esperar);
  }).then(function () {
    Check('GS13 "Actualizar" relee el registro conservando la vista y el detalle', [true, 'PRB 2026-000001', VISTA],
      [reg.registro !== regAntes, reg.abierta, vista(p, reg)]);
  });
});

pruebas.push(function () {
  var p = Pagina(), reg, ed, html, estados = [], mensajes = [];
  var errores = [
    [422, { valida: false, guardada: false, errores: [{ campo: 'titulo', mensaje: 'Título demasiado largo' }] }],
    [409, { tipo: 'TopeExcedido', error: '/A/Cat 1: solo tiene 0% disponible', numero: 51010, guardada: false }],
    [409, { tipo: 'PendienteSinRegla', error: 'No se guardó nada: quitar categoría', guardada: false }],
    [500, { tipo: 'EscrituraNoConfirmada', error: 'No se pudo confirmar el guardado: tiempo agotado', guardada: null }],
    [503, { tipo: 'ValidacionNoDisponible', error: 'error 53' }],
    [0, null]
  ];
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    editar(p, 'data-edicion', 'observaciones', 'Obs nueva');
    ed = reg.edicion;
    html = p.sel('regDetCuerpo').innerHTML;
    return errores.reduce(function (c, e) {
      return c.then(function () { return reg.guardarEdicion(Servidor(e[0], e[1]).pedir); }).then(function (r) {
        mensajes.push(p.sel('regEdMsg').innerHTML);
        estados.push([r.estado, reg.edicion === ed, ed.valores.titulo, ed.valores.observaciones,
          p.sel('regDetCuerpo').innerHTML === html, p.sel('regEdGuardar').disabled, /Guardado en la base/.test(mensajes[mensajes.length - 1])]);
      });
    }, Promise.resolve());
  }).then(function () {
    var fila = function (e) { return [e, true, 'Nuevo', 'Obs nueva', true, false, false]; };
    Check('GS14 422/409/409/500/503/red: edicion abierta con lo escrito, sin repintar, boton habilitado, nunca "Guardado"',
      ['invalida', 'rechazada', 'rechazada', 'no_confirmada', 'no_disponible', 'error'].map(fila), estados);
    Check('GS14 ... cada uno con su mensaje real', [true, true, true, true, true],
      [/Título demasiado largo/.test(mensajes[0]), /solo tiene 0% disponible/.test(mensajes[1]), /quitar categoría/.test(mensajes[2]),
       /Revisa el registro antes de reintentar/.test(mensajes[3]), /No se guardó nada/.test(mensajes[4])]);
    var srv = Servidor(200, GUARDADA);
    return reg.guardarEdicion(srv.pedir, RegistroGuardado({ titulo: 'Nuevo', observaciones: 'Obs nueva' })).then(function (r) {
      Check('GS14 ... reintentar guarda y viajan los mismos valores', ['guardada', true, true],
        [r.estado, srv.pedidos[0].campos.some(function (c) { return c[0] === 'titulo' && c[1] === 'Nuevo'; }),
         srv.pedidos[0].campos.some(function (c) { return c[0] === 'observaciones' && c[1] === 'Obs nueva'; })]);
    });
  });
});

pruebas.push(function () {
  var p = Pagina(), reg, d = Diferido(), primera, segunda;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    primera = reg.guardarEdicion(d.pedir, RegistroGuardado({ titulo: 'Nuevo' }));
    segunda = reg.guardarEdicion(d.pedir, RegistroGuardado({ titulo: 'Nuevo' }));
    accion(p, 'edicion-guardar');
    return esperar();
  }).then(function () {
    Check('GS15 mientras guarda: un solo POST, Guardar y Cancelar deshabilitados, "Guardando…"', [1, true, true, true],
      [d.pedidos, p.sel('regEdGuardar').disabled, p.sel('regEdCancelar').disabled, /Guardando/.test(p.sel('regEdMsg').innerHTML)]);
    editar(p, 'data-edicion', 'titulo', 'Escrito mientras guarda');
    accion(p, 'edicion-cancelar');
    Check('GS15 ... mientras guarda no se edita ni se cancela; cerrar no pregunta (ya viaja)', ['Nuevo', true],
      [reg.edicion.valores.titulo, !reg.hayCambiosSinGuardar()]);
    return segunda;
  }).then(function (r2) {
    Check('GS15 el segundo envio no manda nada', null, r2);
    d.responder(409, { tipo: 'TopeExcedido', error: 'tope', guardada: false });
    return primera;
  }).then(function (r) {
    Check('GS15 tras la respuesta: botones habilitados (reintento posible), lo escrito sigue, un solo POST en total', ['rechazada', false, false, 'Nuevo', 1],
      [r.estado, p.sel('regEdGuardar').disabled, p.sel('regEdCancelar').disabled, reg.edicion.valores.titulo, d.pedidos]);
  });
});

// GS16) FiltroRegistro.sobre: Estado y Tipo viajan TAL CUAL al registro
// nuevo, aunque el valor elegido ya no tenga iniciativas (el filtro no
// cambia solo); lo marcado es inclusion: un estado que aparece por primera
// vez no entra. Al tocar el filtro, lo que ya no es opcion se suelta.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var f = p.registro.filtro;
    f.elegirEstado('En Solución');               // solo MAP 2026-000003
    f.tipos.solo('MAP');
    f.buscar('MAP');
    var json = JSON.parse(JSON.stringify(REGISTRO));
    json.iniciativas[2].estado = 'Cerrado';       // 'En Solución' ya no existe; 'Cerrado' aparece por primera vez
    var nuevo = p.ventana.RegistroIniciativas.Registro.desdeJson(json);
    var g = f.sobre(nuevo);
    Check('GS16 sobre(): texto, tipos y el estado elegido se conservan aunque ya no exista; el nuevo no entra; lista vacia',
      ['MAP', ['MAP'], ['En Solución'], false, 0, true],
      [g.textoBuscado, g.tipos.marcados, g.estados.marcados, g.estados.marcados === f.estados.marcados,
       g.aplicar(nuevo.iniciativas).length, g.registro === nuevo]);
    g.alternarEstado('En Análisis');
    Check('GS16 ... al tocar el filtro, el valor que ya no es opcion se suelta', ['En Análisis'], g.estados.marcados);
  });
});

// GS17-GS23) Carrera guardado/navegacion y vistas que se conservan.
pruebas.push(function () {
  var p = Pagina(), reg, d = Diferido(), guardado, regAntes;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    vistaFiltrada(p, reg);
    regAntes = reg.registro;
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    guardado = reg.guardarEdicion(d.pedir, RegistroGuardado({ titulo: 'Nuevo', titulo_problem: 'Nuevo' }));
    return esperar();
  }).then(function () {
    reg.cerrarDetalle();                          // el usuario cierra A mientras se guarda
    d.responder(200, GUARDADA);
    return guardado;
  }).then(function (r) {
    Check('GS17 A guardada tras cerrar su detalle: la lista se relee con la vista intacta y A NO se reabre',
      ['guardada', true, 'Nuevo', VISTA, null, true, null, true],
      [r.estado, reg.registro !== regAntes, reg.registro.buscar('PRB 2026-000001').titulo, vista(p, reg),
       reg.abierta, p.sel('regDetalle').hidden, reg.edicion, /Nuevo/.test(p.sel('regCuerpo').innerHTML)]);
  });
});

pruebas.push(function () {
  var p = Pagina(), reg, d = Diferido(), guardado, edB;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    vistaFiltrada(p, reg);
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    guardado = reg.guardarEdicion(d.pedir, RegistroGuardado({ titulo: 'Nuevo', titulo_problem: 'Nuevo' }));
    return esperar();
  }).then(function () {
    // El usuario abre B y empieza a modificarla antes de que A responda.
    reg.modificar('PRB 2026-000002');
    editar(p, 'data-edicion', 'observaciones', 'Borrador B');
    edB = reg.edicion;
    d.responder(200, GUARDADA);
    return guardado;
  }).then(function (r) {
    Check('GS18 A guardada mientras B esta abierta con borrador: lista releida, vista intacta, B y su borrador intactos, sin aviso de A',
      ['guardada', 'Nuevo', VISTA, 'PRB 2026-000002', 'PRB 2026-000002', true, 'Borrador B', false],
      [r.estado, reg.registro.buscar('PRB 2026-000001').titulo, vista(p, reg), reg.abierta, p.sel('regDetTitulo').textContent,
       reg.edicion === edB, edB.valores.observaciones, /Guardado en la base/.test(p.sel('regDetAviso').innerHTML)]);
  });
});

pruebas.push(function () {
  var p = Pagina(), reg, d = Diferido(), guardado, cambio;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    guardado = reg.guardarEdicion(d.pedir, RegistroGuardado({ titulo: 'Nuevo', titulo_problem: 'Nuevo' }));
    return esperar();
  }).then(function () {
    // Sigue en A, pero cierra Modificar y abre "Solicitar cambios".
    accion(p, 'edicion-cancelar');
    accion(p, 'solicitar-cambios');
    cambio = reg.cambio;
    d.responder(200, GUARDADA);
    return guardado;
  }).then(function () {
    var aviso = p.sel('regDetAviso');
    Check('GS19 mismo detalle con "Solicitar cambios" abierto: no se repinta, su borrador sigue; el aviso dice que se guardo',
      ['PRB 2026-000001', true, true, 'Nuevo', true, true],
      [reg.abierta, reg.cambio === cambio, reg.cambioAbierto, reg.registro.buscar('PRB 2026-000001').titulo,
       /Guardado en la base/.test(aviso.innerHTML), /conserva lo que tienes abierto/.test(aviso.innerHTML)]);
  });
});

// Cobertura con catalogo propio (una categoria y un Director que solo
// estan en el catalogo).
var COBERTURA = { omitidas: 0, asignaciones: [
  { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' },
  { director: 'Dir A', po: 'PO 1', so: 'SO y', categoria: '/A/Cat 2' },
  { director: 'Dir C', po: 'PO 9', so: 'SO 9', categoria: '/C/Cat 9' }
] };
function PedirCobertura(cambios, cuenta) {
  var registro = RegistroGuardado(cambios);
  return function (url) {
    if (/catalogos/.test(url)) { cuenta.catalogo++; return Promise.resolve(Respuesta(200, COBERTURA)); }
    return registro(url);
  };
}
pruebas.push(function () {
  var p = Pagina(), reg, cuenta = { catalogo: 0 };
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    return reg.verCobertura(PedirCobertura({}, cuenta));
  }).then(function () {
    reg.filtro.elegirDirector('Dir C');           // solo existe en el catalogo
    reg.refrescar();
    reg.limite = 300;
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    return reg.guardarEdicion(Servidor(200, GUARDADA).pedir, PedirCobertura({ titulo: 'Nuevo', titulo_problem: 'Nuevo' }, cuenta));
  }).then(function (r) {
    Check('GS20 en Cobertura: sigue en Cobertura (rearmada sin volver a pedir el catalogo), Director del catalogo y "mostrar mas" intactos',
      ['guardada', 'cobertura', false, true, 1, 'Dir C', 300, 'Nuevo', true],
      [r.estado, reg.modo, p.sel('covSeccion').hidden, !!reg.cobertura && reg.cobertura.registro === reg.registro, cuenta.catalogo,
       reg.filtro.director, reg.limite, reg.registro.buscar('PRB 2026-000001').titulo, p.sel('covContenido').hidden === false]);
  });
});

pruebas.push(function () {
  var p = Pagina(), reg;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    reg.filtro.elegirEstado('En Análisis');
    reg.refrescar();
    reg.modificar('MAP 2026-000003');             // la unica 'En Solución'
    editar(p, 'data-edicion', 'estado', 'En Análisis');
    var json = JSON.parse(JSON.stringify(REGISTRO));
    json.iniciativas[0].estado = 'Cerrado';       // otra iniciativa cambio de estado en la base (estado nuevo)
    json.iniciativas[2].estado = 'En Análisis';
    return reg.guardarEdicion(Servidor(200, GUARDADA).pedir, function () { return Promise.resolve(Respuesta(200, json)); });
  }).then(function () {
    Check('GS21 entra al estado filtrado: aparece en la lista sin nota; el filtro sigue en "En Análisis" y "Cerrado" (nuevo) no entra',
      [['En Análisis'], true, false, false, 'En Análisis'],
      [reg.filtro.estados.marcados, /MAP 2026-000003/.test(p.sel('regCuerpo').innerHTML), /PRB 2026-000001/.test(p.sel('regCuerpo').innerHTML),
       /ya no coincide/.test(p.sel('regDetAviso').innerHTML), p.sel('regEstado').textContent]);
  });
});

// Crear (Administracion): el alta guardada relee el registro sin tocar la
// vista de Iniciativas ni un detalle abierto con borrador.
pruebas.push(function () {
  var p = Pagina(), reg, regAntes, edB;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    vistaFiltrada(p, reg);
    reg.modificar('PRB 2026-000002');
    editar(p, 'data-edicion', 'observaciones', 'Borrador B');
    edB = reg.edicion;
    regAntes = reg.registro;
    return p.pagina.crearAdmin.alGuardar('ADO 2026-000074');
  }).then(function (res) {
    Check('GS22 alta guardada: registro releido (no cargar()); filtros, busqueda, orden, "mostrar mas", modo, detalle y borrador intactos',
      [true, true, VISTA, 'PRB 2026-000002', true, 'Borrador B', false],
      [res.ok, reg.registro !== regAntes, vista(p, reg), reg.abierta, reg.edicion === edB, edB.valores.observaciones, p.sel('regDetalle').hidden]);
  });
});

pruebas.push(function () {
  var p = Pagina(), reg, regAntes, filtroAntes;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    vistaFiltrada(p, reg);
    regAntes = reg.registro; filtroAntes = reg.filtro;
    return reg.actualizar(function () { return Promise.resolve(Respuesta(500, { error: 'error 53' })); });
  }).then(function (res) {
    Check('GS23 actualizar() que falla: no rechaza, dice el error y deja la vista anterior intacta (sin pantalla de error)',
      [false, 'error 53', true, true, VISTA, true],
      [res.ok, res.error && res.error.message, reg.registro === regAntes, reg.filtro === filtroAntes, vista(p, reg), p.sel('regError').hidden]);
    var caja = p.sel('admResultado');
    caja.innerHTML = '<p>Guardado ADO 2026-000074</p>';
    reg.actualizar = function () { return Promise.resolve({ ok: false, error: new Error('error 53') }); };
    return p.pagina.crearAdmin.alGuardar('ADO 2026-000074').then(function () {
      Check('GS23 ... alta guardada con relectura fallida: la respuesta del alta se conserva y se agrega el aviso', [true, true],
        [/Guardado ADO 2026-000074/.test(caja.innerHTML), /Se guardó, pero la lista de Iniciativas no se pudo actualizar: error 53/.test(caja.innerHTML)]);
    });
  });
});

// GS24-GS25) Indicadores tras guardar: salen del registro releido (no de
// lo filtrado) y la vista no se toca. REGISTRO: 3 abiertas, las 3 Activas.
function kpisDe(p) {
  var re = /<div class="val">([^<]*)<\/div>/g, m, s = [];
  while ((m = re.exec(p.sel('regKpis').innerHTML))) s.push(m[1]);
  return s;
}
pruebas.push(function () {
  var p = Pagina(), reg, antes;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    vistaFiltrada(p, reg);
    antes = kpisDe(p);
    reg.modificar('PRB 2026-000001');
    editar(p, 'data-edicion', 'titulo', 'Nuevo');
    // La relectura trae la iniciativa cerrada (p. ej. otro cambio en la base).
    return reg.guardarEdicion(Servidor(200, GUARDADA).pedir,
      RegistroGuardado({ titulo: 'Nuevo', titulo_problem: 'Nuevo', estado: 'Cerrado', activa: false, seguimiento: false }));
  }).then(function (r) {
    Check('GS24 Modificar guardado: indicadores del registro releido (Total = abiertas, Activas, Requerimientos, Atrasadas, Cerradas)',
      [['3', '3', '0', '0', '0'], 'guardada', ['2', '2', '0', '0', '1']], [antes, r.estado, kpisDe(p)]);
    Check('GS24 ... filtros, busqueda, orden, "mostrar mas", modo y detalle intactos', [VISTA, 'PRB 2026-000001'],
      [vista(p, reg), reg.abierta]);
  });
});

pruebas.push(function () {
  var p = Pagina(), reg, edB, antes;
  return esperar().then(function () {
    reg = p.registro;
    p.pagina.fijarRol('ADM');
    reg.registro.persistenciaAdmin = true;
    vistaFiltrada(p, reg);
    reg.modificar('PRB 2026-000002');
    editar(p, 'data-edicion', 'observaciones', 'Borrador B');
    edB = reg.edicion;
    antes = kpisDe(p);
    // La relectura del alta trae una iniciativa mas, abierta y fuera de
    // Activas (agrupacion que no es de las del servidor).
    var json = JSON.parse(JSON.stringify(REGISTRO));
    json.iniciativas.push(Ini('ADO 2026-000074', { prefijo: 'ADO', agrup: 'Adopcion', seguimiento: false }));
    var original = reg.actualizar;
    reg.actualizar = function () {
      return original.call(reg, function () { return Promise.resolve(Respuesta(200, json)); });
    };
    return p.pagina.crearAdmin.alGuardar('ADO 2026-000074');
  }).then(function (res) {
    Check('GS25 Crear guardado: Total sube y la nueva (fuera de seguimiento) no cuenta en Activas',
      [['3', '3', '0', '0', '0'], true, ['4', '3', '0', '0', '0']], [antes, res.ok, kpisDe(p)]);
    Check('GS25 ... filtros, busqueda, orden, "mostrar mas", modo, detalle y borrador intactos',
      [VISTA, 'PRB 2026-000002', true, 'Borrador B'], [vista(p, reg), reg.abierta, reg.edicion === edB, edB.valores.observaciones]);
  });
});

// ---------------------------------------------------------------------------
// CA) Categorias de ADM aunque les falten duenos (rutas_adm, solo con ADM) y
//     el selector de SLA (assets/js/desplegable.js) en Crear / Modificar.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var conAdm = JSON.parse(JSON.stringify(CATALOGO));
  conAdm.rutas_adm = [
    { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' },
    { director: 'Dir Z', po: null, so: 'SO z', categoria: '/Z/Sin PO' },
    { director: null, po: null, so: null, categoria: '/Z/Sin fila' },
    { director: null, po: null, so: null, categoria: ' /z/sin fila ' },
    { categoria: '' }, null
  ];
  conAdm.rutas_adm_sin_duenos = 2;
  var cat = I.CatalogoIniciativas.desdeJson(conAdm);
  Check('CA1 desdeJson: rutas_adm sin repetidas ni vacias, duenos que faltan = ""',
    [['/A/Cat 1', '/Z/Sin PO', '/Z/Sin fila'], { categoria: '/Z/Sin PO', director: 'Dir Z', po: '', so: 'SO z' }],
    [cat.rutasAdm.map(function (f) { return f.categoria; }), cat.rutasAdm[1]]);
  Check('CA2 la cascada (Nueva solicitud) sigue sobre `rutas`: sin las rutas sin duenos',
    ['/A/Cat 1', '/A/Cat 2', '/B/Cat 4'], cat.asignaciones.map(function (f) { return f.categoria; }));
  Check('CA3 sin rutas_adm (MOD): rutasAdm = null y ADM cae a las de la cascada',
    [null, ['/A/Cat 1', '/A/Cat 2', '/B/Cat 4']],
    [I.CatalogoIniciativas.desdeJson(CATALOGO).rutasAdm, A.BorradorAdmin.rutasAdmDe(I.CatalogoIniciativas.desdeJson(CATALOGO))]);
  var b = new A.BorradorAdmin(cat);
  Check('CA4 Crear (ADM) ofrece todas las rutas activas, con o sin duenos', ['/A/Cat 1', '/Z/Sin PO', '/Z/Sin fila'], b.categorias.rutas);
  Check('CA5 PO / SO de Crear: solo de las filas completas (sin cambio)', [['PO 1', 'PO 3'], ['SO x', 'SO y', 'SO z']],
    [b.duenosLista.po, b.duenosLista.so]);
  Check('CA6 duenosFaltantes dice lo que falta, nunca lo inventa',
    [['Product Owner'], ['Director', 'Product Owner', 'Service Owner'], [], []],
    [A.BorradorAdmin.duenosFaltantes(cat, '/Z/Sin PO'), A.BorradorAdmin.duenosFaltantes(cat, '/z/sin fila'),
     A.BorradorAdmin.duenosFaltantes(cat, '/A/Cat 1'), A.BorradorAdmin.duenosFaltantes(cat, '/No/Existe')]);
  var r1 = b.agregarCategoria('/Z/Sin PO');
  Check('CA7 agregar la ruta sin PO: aceptada; Director el resuelto', [true, 'Dir Z'], [r1.ok, b.director()]);
  b.agregarCategoria('/Z/Sin fila');
  Check('CA8 con una ruta sin Director, el Director sigue siendo el unico conocido', 'Dir Z', b.director());
  Check('CA9 escribir una ruta fuera del catalogo sigue rechazandose', false, b.agregarCategoria('/Inventada').ok);

  var html = A.Selector.desplegable('x', ['/A/Cat 1', '/Z/<b>'], '/A/Cat 1');
  Check('CA10 Selector.desplegable: siempre <select> real (sin datalist), escapado, con "Elige" y la elegida',
    [true, false, true, true, true],
    [/^<select id="x" class="ini-dd-categoria">/.test(html), /datalist/.test(html), /&lt;b&gt;/.test(html),
     /<option value="">— Elige —<\/option>/.test(html), /value="\/A\/Cat 1" selected/.test(html)]);
  var muchas = []; for (var i = 0; i < 50; i++) muchas.push('/R/' + i);
  Check('CA11 con mas de 20 opciones sigue siendo <select> (el buscador lo pone el desplegable)', true,
    /^<select/.test(A.Selector.desplegable('y', muchas, '')));
  var montadas = [], antes = base.ventana.Desplegable;
  var raiz = { querySelectorAll: function (q) { return q === 'select.ini-dd-categoria' ? [1] : []; } };
  base.ventana.Desplegable = undefined;
  Check('CA12 sin desplegable.js no monta nada (queda el <select> nativo)', false, A.Selector.montar(raiz));
  base.ventana.Desplegable = { montar: function (r) { montadas.push(r); } };
  Check('CA13 con desplegable.js monta sobre la raiz dada (no sobre todo el documento)', [true, true],
    [A.Selector.montar(raiz), montadas[0] === raiz]);
  Check('CA14 raiz sin selectores de categoria: no monta', [false, 1],
    [A.Selector.montar({ querySelectorAll: function () { return []; } }), montadas.length]);
  base.ventana.Desplegable = antes;

  var htmlPag = leer('admin/iniciativas.html');
  Check('CA15 iniciativas.html carga el desplegable de SLA (hoja y script)', [true, true],
    [/assets\/css\/desplegable\.css/.test(htmlPag), /assets\/js\/desplegable\.js/.test(htmlPag)]);
});

// MT) Crear: meta en % o en tickets y Volumetria fijada por ADM (sql/26)
pruebas.push(function () {
  var M = A.MetaCategoria;
  Check('MT1 % -> tickets: SIEMPRE hacia abajo (FLOOR), entero', [41, 52, 0, 3, 0, 418, 0, 0, 7, 6],
    [M.tickets(418, '10'), M.tickets(418, '12.5'), M.tickets(1000, '0.05'), M.tickets(7, '50'), M.tickets(0, '50'),
     M.tickets(418, '100'), M.tickets(418, '0'), M.tickets(7, '9.46'), M.tickets(7, '100'), M.tickets(7, '99.99')]);
  Check('MT1b los tickets siempre son enteros y nunca pasan del exacto', true,
    [7, 10, 418, 1247, 30000].every(function (v) {
      return ['0.01', '9.46', '12.5', '33.33', '50', '66.67', '99.99', '100'].every(function (pc) {
        var t = M.tickets(v, pc);
        return t % 1 === 0 && t >= 0 && t <= v * Number(pc) / 100 + 1e-9 && t > v * Number(pc) / 100 - 1;
      });
    }));
  Check('MT2 % -> tickets sin dato o invalido: null (nunca un numero inventado)', [null, null, null, null, null, null],
    [M.tickets(null, '10'), M.tickets(418, ''), M.tickets(418, '101'), M.tickets(418, '-1'), M.tickets(418, '1.234'), M.tickets(-5, '10')]);
  Check('MT3 tickets -> %: el menor % con dos decimales que da esos tickets (FLOOR), y si es exacto',
    [['10.05', true, 42], ['57.15', true, 4], ['100', true, 418], ['0', true, 0]],
    [[M.pct(418, '42').pct, M.pct(418, '42').exacto, M.pct(418, '42').tickets], [M.pct(7, 4).pct, M.pct(7, 4).exacto, M.pct(7, 4).tickets],
     [M.pct(418, '418').pct, M.pct(418, '418').exacto, M.pct(418, '418').tickets], [M.pct(418, '0').pct, M.pct(418, '0').exacto, M.pct(418, '0').tickets]]);
  var grande = M.pct(200000, '1');
  Check('MT4 volumetria grande: 0.01% es mas de un ticket; el % no es exacto y se dice cuantos da', ['0.01', false, 20],
    [grande.pct, grande.exacto, grande.tickets]);
  Check('MT5 tickets -> %: vacio sin error; formato, negativos, sin volumetria, volumetria 0 y mas de 100%: error',
    ['', true, true, true, true, true, true],
    [M.pct(418, '').error, /entero/.test(M.pct(418, '-3').error), /entero/.test(M.pct(418, '2.5').error),
     /Sin volumetría/.test(M.pct(null, '5').error), /volumetría 0/.test(M.pct(0, '5').error), /más que la volumetría/.test(M.pct(1000, '1001').error),
     /entero/.test(M.pct(418, 'diez').error)]);
  Check('MT6 FORMATO.entero: 0 y el maximo de int; negativo, decimal, signo y mas de int no', ['', '', true, true, true, true],
    [A.FORMATO.entero('0'), A.FORMATO.entero('2147483647'), !!A.FORMATO.entero('-1'), !!A.FORMATO.entero('1.5'),
     !!A.FORMATO.entero('+3'), !!A.FORMATO.entero('2147483648')]);

  // El modelo: lo escrito (fuente) nunca se pisa.
  var cats = new A.CategoriasProblema([], ['/A/Cat 1', '/A/Cat 2']);
  var calc = { '/A/CAT 1': { estado: 'ok', valor: 418 }, '/A/CAT 2': { estado: 'cero', valor: 0 } };
  var vol = { estado: function (r) { return calc[String(r).trim().toUpperCase()] || null; } };
  cats.agregar('/A/Cat 1');
  cats.sincronizarCalculadas(vol);
  var f = cats.filas[0];
  cats.capturarPct(0, '10');
  Check('MT7 modo %: el % escrito y los tickets calculados con la volumetria calculada (418 x 10% = 41.8 -> 41)', ['10', 'pct', '= 41 tickets de 418'],
    [f.valor, f.fuente, cats.meta(f).texto]);
  cats.elegirModo('tickets');
  Check('MT8 cambiar a tickets no convierte ni toca lo escrito: % igual, casilla de tickets con los calculados', ['tickets', '10', 'pct', '41'],
    [cats.modo, f.valor, f.fuente, cats.ticketsVista(f)]);
  cats.capturarTickets(0, '100');
  Check('MT9 escribir tickets: el % sale de ellos (100 / 418 -> 23.93%, que da 100) y es exacto', ['23.93', 'tickets', '100', '≈ 23.93% de 418'],
    [f.valor, f.fuente, cats.ticketsVista(f), cats.meta(f).texto]);
  cats.capturarVolumen(0, '1000');
  Check('MT10 cambiar la volumetria: los tickets escritos se quedan, el % se recalcula; el modo no cambia', ['10', '100', 'tickets'],
    [f.valor, f.tickets, cats.modo]);
  cats.capturarVolumen(0, '');
  Check('MT11 volumetria vacia = vuelve a la calculada', ['23.93', 418], [f.valor, cats.volumen(f)]);
  cats.capturarVolumen(0, '-5');
  var errs = cats.erroresFormato().map(function (e) { return e.clave; });
  Check('MT12 volumetria invalida: sin denominador; % vacio y dos errores (volumetria y tickets), nada se manda a medias', ['', true, true],
    [f.valor, errs.indexOf('volumetria') >= 0, errs.indexOf('tickets') >= 0]);
  cats.capturarVolumen(0, '0');
  Check('MT13 volumetria 0 con tickets: error de division (no Infinity ni NaN)', ['', true],
    [f.valor, cats.erroresFormato().some(function (e) { return e.clave === 'tickets' && /volumetría 0/.test(e.mensaje); })]);
  cats.capturarVolumen(0, '50');
  Check('MT14 mas tickets que la volumetria: error, nunca se recorta a 100%', ['', true],
    [f.valor, cats.erroresFormato().some(function (e) { return /más que la volumetría/.test(e.mensaje); })]);
  cats.capturarTickets(0, '');
  Check('MT15 borrar los tickets: el % queda vacio (Incompleta), sin error', ['', 0], [f.valor, cats.erroresFormato().length]);
  cats.elegirModo('pct');
  cats.capturarPct(0, '5');
  cats.capturarVolumen(0, '2000');
  Check('MT16 modo % con volumetria fijada: el % escrito se queda y los tickets se recalculan', ['5', 'pct', '= 100 tickets de 2,000'],
    [f.valor, f.fuente, cats.meta(f).texto]);
  Check('MT17 un modo que no existe no cambia nada', [false, 'pct'], [cats.elegirModo('x'), cats.modo]);

  var c2 = new A.CategoriasProblema([], ['/A/Cat 1', '/A/Cat 2']);
  c2.agregar('/A/Cat 1'); c2.agregar('/A/Cat 2'); c2.sincronizarCalculadas(vol);
  Check('MT18 sin volumetria fijada: no viaja (la base guarda NULL, como hoy)', '', c2.volumetriaProblema());
  c2.capturarVolumen(0, '1000');
  Check('MT19 con una fijada: la del problema es la suma de la que usa cada categoria (1000 + 0 calculada)', '1000', c2.volumetriaProblema());
  c2.capturarVolumen(1, '25');
  Check('MT20 dos fijadas: 1025', '1025', c2.volumetriaProblema());
  c2.quitar(1);
  Check('MT21 quitar una: ya no suma', '1000', c2.volumetriaProblema());

  // La pantalla, con sql/26 en la base (volumetria_manual del registro).
  REGISTRO.volumetria_manual = true;
  var p = Pagina(), v;
  return esperar().then(function () {
    delete REGISTRO.volumetria_manual;
    var pg = p.pagina;
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    v = pg.crearAdmin;
    elegir(p, 'admTipo', 'ADO');
    v.agregarCategoria('/A/Cat 1');
    return esperar().then(esperar);
  }).then(function () {
    var html = p.sel('admCats').innerHTML, caja = p.sel('admCats');
    Check('MT22 con sql/26: Volumetria editable (vacia, con la calculada de referencia) y modo % activo', [true, true, true, true, false, false],
      [/data-crear-vol="0"/.test(html), /placeholder="418"/.test(html), /Calculada: <output/.test(html), /data-crear-pct="0"/.test(html),
       /data-crear-tickets/.test(html), p.sel('admModoPct').disabled]);
    var salida = Elemento('out'); caja.querySelector = function (s) { return s === '[data-crear-meta="0"]' ? salida : null; };
    var t = Elemento('t'); t.setAttribute('data-crear-pct', '0'); t.value = '10';
    caja.disparar('input', { target: t });
    Check('MT23 escribir el %: solo se actualiza lo calculado de esa fila (no la casilla)', ['= 41 tickets de 418', html],
      [salida.textContent, caja.innerHTML]);
    Check('MT24 sin volumetria fijada no viaja la volumetria (default de siempre)', false,
      v.borrador.paraEnviar().some(function (par) { return par[0] === 'volumetria'; }));
    var tv = Elemento('tv'); tv.setAttribute('data-crear-vol', '0'); tv.value = '1500';
    caja.disparar('input', { target: tv });
    var pares = v.borrador.paraEnviar();
    Check('MT25 fijarla: viaja como volumetria y el % es el escrito; avisa lo que guardara la base (FLOOR(418 x 10%) = 41)',
      [['volumetria', '1500'], ['cat_pct', '10'], '= 150 tickets de 1,500 · la base guardará 41 en Tickets a reducir (calcula sobre los últimos 30 días: 418)'],
      [pares.filter(function (x) { return x[0] === 'volumetria'; })[0], pares.filter(function (x) { return x[0] === 'cat_pct'; })[0], salida.textContent]);
    var radio = p.sel('admModoTickets'); radio.value = 'tickets'; radio.checked = true; radio.disparar('change');
    html = caja.innerHTML;
    Check('MT26 modo tickets: casilla de tickets con los calculados, encabezado y radio', [true, true, false, true, false],
      [/data-crear-tickets="0" value="150"/.test(html), /Tickets a resolver<\/th>/.test(html), /data-crear-pct="0"/.test(html),
       p.sel('admModoTickets').checked, p.sel('admModoPct').checked]);
    var tk = Elemento('tk'); tk.setAttribute('data-crear-tickets', '0'); tk.value = '200';
    caja.disparar('input', { target: tk });
    pares = v.borrador.paraEnviar();
    Check('MT27 escribir tickets: viaja el % equivalente (200 / 1500 -> 13.34%, que da 200), y que es exacto', [['cat_pct', '13.34'], '≈ 13.34% de 1,500'],
      [pares.filter(function (x) { return x[0] === 'cat_pct'; })[0], salida.textContent.split(' · ')[0]]);
    tv.value = '200000'; caja.disparar('input', { target: tv });
    tk.value = '1'; caja.disparar('input', { target: tk });
    Check('MT27b 1 ticket de 200,000 no cabe en 2 decimales: el menor % (0.01) y se dice cuantos da (no se esconde)',
      ['0.01', '≈ 0.01% de 200,000 · con 2 decimales son 20 tickets'],
      [v.borrador.categorias.filas[0].valor, salida.textContent.split(' · la base')[0]]);
    tv.value = '1500'; caja.disparar('input', { target: tv });
    tk.value = '200'; caja.disparar('input', { target: tk });
    Check('MT28 revisar: listo (nada bloquea) y nunca guarda', [true, false], [v.borrador.revisar().listo, v.borrador.revisar().guardado]);
    tk.value = '-1'; caja.disparar('input', { target: tk });
    Check('MT29 tickets negativos: no se puede enviar (error), el % no se inventa', [false, '', 'ini-meta mal'],
      [v.borrador.revisar().listo, v.borrador.categorias.filas[0].valor, salida.className]);
  }).then(function () {
    // Sin sql/26 (sin la bandera): la volumetria sigue siendo de solo lectura,
    // pero la meta en tickets tambien se puede usar (solo viaja el %).
    var p2 = Pagina(), v2;
    return esperar().then(function () {
      var pg = p2.pagina;
      pg.fijarRol('ADM');
      pg.mostrarVista('crear');
      v2 = pg.crearAdmin;
      elegir(p2, 'admTipo', 'ADO');
      v2.agregarCategoria('/A/Cat 1');
      return esperar().then(esperar);
    }).then(function () {
      var html = p2.sel('admCats').innerHTML;
      Check('MT30 sin sql/26: sin casilla de volumetria (Calculada, solo lectura) y no viaja', [false, true, false],
        [/data-crear-vol/.test(html), /derivado">Calculada<\/span><\/th>/.test(html),
         v2.borrador.paraEnviar().some(function (par) { return par[0] === 'volumetria'; })]);
      v2.elegirModo('tickets');
      var tk = Elemento('tk'); tk.setAttribute('data-crear-tickets', '0'); tk.value = '42';
      p2.sel('admCats').disparar('input', { target: tk });
      Check('MT31 sin sql/26, tickets con la calculada: 42 / 418 = 10.05%', ['cat_pct', '10.05'],
        v2.borrador.paraEnviar().filter(function (x) { return x[0] === 'cat_pct'; })[0]);
      // Modificar (ADM): % o tickets por categoria, volumetria nunca editable.
      var reg = p2.registro;
      reg.modificar('PRB 2026-000001');
      var hPct = A.htmlCategoriasEdicion(reg.edicion, null);
      reg.edicion.categorias.modo = 'tickets';
      var hEd = A.htmlCategoriasEdicion(reg.edicion, null);
      Check('MT32 Modificar: modo %, sin volumetria editable; modo tickets, casillas de tickets y meta; selector de modo',
        [true, false, true, true, true, true],
        [/data-edicion-pct="0"/.test(hPct), /data-[a-z]+-vol=/.test(hEd), /data-edicion-tickets="0"/.test(hEd), /data-edicion-meta=/.test(hPct),
         /name="regEdModo" value="tickets" data-edicion-modo checked/.test(hEd), /derivado">Calculada<\/span><\/th><th scope="col">Tickets a resolver/.test(hEd)]);
    });
  });
});

// ---------------------------------------------------------------------------
// MV) Meta % <-> tickets con la volumetria de los ULTIMOS 30 DIAS (ADM,
//     alcance=total -> ultimos30; 2026-10-26): conversiones con FLOOR,
//     bordes, Modificar (nuevas y ligadas), que lo mostrado es lo que guarda
//     la base (TicketsReduce sobre VolumenUltimos30) y que el total
//     historico nunca se pinta.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var M = A.MetaCategoria;
  Check('MV1 % -> tickets: 2.5% de 1000 = 25; 10.05% de 418 = 42; hacia abajo (5% de 10 = 0.5 -> 0)', [25, 42, 0],
    [M.tickets(1000, '2.5'), M.tickets(418, '10.05'), M.tickets(10, '5')]);
  Check('MV1b el caso reportado: volumen 7 con 9.46% = 0 y con 100% = 7', [0, 7], [M.tickets(7, '9.46'), M.tickets(7, '100')]);
  Check('MV2 % -> tickets, bordes: 0%, 100%, vol 0, % vacio o sin volumetria = null', [0, 1000, 0, null, null],
    [M.tickets(1000, '0'), M.tickets(1000, '100'), M.tickets(0, '50'), M.tickets(1000, ''), M.tickets(null, '10')]);
  var a = M.pct(1000, '25'), b = M.pct(1000, '1000'), c = M.pct(1000, '0');
  Check('MV3 tickets -> %: 25 de 1000 = 2.5% exacto; el maximo (1000) = 100%; 0 = 0%', ['2.5', true, '100', true, '0', true],
    [a.pct, a.exacto, b.pct, b.exacto, c.pct, c.exacto]);
  Check('MV4 tickets -> %, rechazos: mas que la volumetria, negativos, decimales, vol 0, sin vol; vacio sin mensaje',
    [true, true, true, true, true, ''],
    [/más que la volumetría/.test(M.pct(1000, '1001').error), !!M.pct(1000, '-1').error, !!M.pct(1000, '2.5').error,
     /volumetría 0/.test(M.pct(0, '5').error), /Sin volumetría/.test(M.pct(null, '5').error), M.pct(1000, '').error]);
  var g = M.pct(30000, '1');
  Check('MV5 redondeo con 2 decimales: 1 de 30000 -> 0.01% (inexacto, se avisa con los que da: 3)', ['0.01', false, 3], [g.pct, g.exacto, g.tickets]);

  // Cliente alcance=total (Crear / Modificar de ADM).
  var pedidosV = [];
  var cuerpo = { '/A/Cat 1': { estado: 'ok', volumetria: 1000, ultimos30: 100 }, '/A/Cat 2': { estado: 'ok', volumetria: 400, ultimos30: 30 },
                 // 74 historicos, ninguno en 30 dias: el servidor dice ok (por el total).
                 '/A/Cat 3': { estado: 'ok', volumetria: 74, ultimos30: 0 },
                 // Servidor sin ultimos30: error, nunca el total ni 0.
                 '/A/Cat 4': { estado: 'ok', volumetria: 50 } };
  var pedirV = function (url) {
    pedidosV.push(url);
    var ruta = decodeURIComponent((/ruta=([^&]*)/.exec(url) || [])[1] || '');
    var f = cuerpo[ruta];
    return Promise.resolve(Respuesta(200, { alcance: 'total', rutas: [{ ruta: ruta, estado: f.estado, volumetria: f.volumetria, ultimos30: f.ultimos30 }] }));
  };
  var vol = new A.VolumetriaCliente(pedirV, A.ALCANCE_TOTAL);
  var porOmision = new A.VolumetriaCliente(pedirV);
  return Promise.all([vol.consultar('/A/Cat 1'), vol.consultar('/A/Cat 2'), porOmision.consultar('/A/Cat 2'),
                      vol.consultar('/A/Cat 3'), vol.consultar('/A/Cat 4')]).then(function (r) {
    Check('MV6 alcance=total: pide alcance=total; por omision (Nueva solicitud / Solicitar cambios) no lo pide',
      [true, false], [/\?alcance=total&ruta=%2FA%2FCat%201/.test(pedidosV[0]), /alcance/.test(pedidosV[2])]);
    Check('MV7 alcance=total: valor = los ultimos 30 dias (100), nunca el total historico (1000)', [100, 100, 'ok', '100 tickets (últimos 30 días)', false],
      [r[0].valor, r[0].ultimos30, r[0].estado, A.VolumetriaCliente.texto(r[0]), /1,000|1000/.test(A.htmlVolumetria(r[0]))]);
    Check('MV7c sin tickets en 30 dias (74 historicos): cero, 0 tickets, 100% = 0 (nunca negativo)', ['cero', 0, '0 tickets en los últimos 30 días', 0, false],
      [r[3].estado, r[3].valor, A.VolumetriaCliente.texto(r[3]), M.tickets(r[3].valor, '100'), /74/.test(A.htmlVolumetria(r[3]))]);
    Check('MV7d servidor sin ultimos30: error (ni el total ni 0)', ['error', null, true],
      [r[4].estado, r[4].valor, /últimos 30 días/.test(A.VolumetriaCliente.texto(r[4]))]);
    Check('MV7b por omision: el texto de siempre (ultimos 30 dias), sin ultimos30', ['400 tickets (últimos 30 días)', null],
      [A.VolumetriaCliente.texto(r[2]), r[2].ultimos30 === undefined ? null : r[2].ultimos30]);

    // Modificar: una ligada (/A/Cat 1, 50%) + una nueva (/A/Cat 2).
    var ini = Ini('PRB 2026-000190', { categorias: [Cat('/A/Cat 1', 0.5)] });
    var ed = new A.EdicionAdmin(ini, { rutas: ['/A/Cat 1', '/A/Cat 2'] });
    ed.categorias.agregar('/A/Cat 2');
    ed.categorias.elegirModo('tickets');
    var html = A.htmlCategoriasEdicion(ed, vol);
    var nueva = ed.categorias.filas[1], ligada = ed.categorias.filas[0];
    Check('MV8 a cada fila llega la de 30 dias, la misma que usa la base (volCalc = vol30)', [100, 100, 30, 30],
      [ligada.volCalc, ligada.vol30, nueva.volCalc, nueva.vol30]);
    Check('MV9 modo tickets: la ligada muestra los tickets de su % (50% de 100 = 50) con tope = volumetria de 30 dias', [true, true],
      [/data-edicion-tickets="0" value="50"/.test(html), /max="100" data-edicion-tickets="0"/.test(html)]);
    ed.capturarTickets(1, '15');
    Check('MV10 tickets en la nueva: % derivado 50 (15 / 30); lo escrito no se toca', ['50', '15', 'tickets'],
      [nueva.valor, nueva.tickets, nueva.fuente]);
    Check('MV11 viaja el % derivado como agregar_pct (solo el %)', ['agregar_pct', '50'],
      ed.paraEnviar().filter(function (p) { return p[0] === 'agregar_pct'; })[0]);
    Check('MV12 lo mostrado es lo que guardara la base: sin aviso de diferencia; FLOOR(30 x 50%) = 15', ['≈ 50% de 30', 15, 15],
      [ed.categorias.meta(nueva).texto, ed.categorias.ticketsGuardados(nueva), A.MetaCategoria.tickets(ed.categorias.volumen(nueva), nueva.valor)]);
    Check('MV12b preview = guardado para cualquier %: ligada y nueva, 0.01% .. 100%', true,
      ['0', '0.01', '9.46', '33.33', '50', '66.67', '99.99', '100'].every(function (pc) {
        return [ligada, nueva].every(function (f) {
          var guardaba = f.valor, fuente = f.fuente; f.valor = pc; f.fuente = 'pct';
          var ok = ed.categorias.ticketsGuardados(f) === A.MetaCategoria.tickets(ed.categorias.volumen(f), pc) &&
            !/la base guardará/.test(ed.categorias.meta(f).texto);
          f.valor = guardaba; f.fuente = fuente;
          return ok;
        });
      }));
    Check('MV13 el cambio lista la meta escrita junto al %', true,
      ed.cambios().some(function (c) { return c.clave === 'agregar_categoria' && /50% \(meta: 15 tickets\)/.test(c.nuevo); }));
    var hTk = A.htmlCategoriasEdicion(ed, vol);
    Check('MV14 repintar no pisa lo escrito: la casilla de tickets sigue en 15', true, /data-edicion-tickets="1" value="15"/.test(hTk));
    // Cambia la volumetria: se recalcula el % (contraparte), no los tickets.
    var k30 = Object.keys(vol.memo).filter(function (k) { return vol.memo[k].valor === 30; })[0];
    vol.memo[k30].valor = 60; vol.memo[k30].ultimos30 = 60;
    A.htmlCategoriasEdicion(ed, vol);
    Check('MV15 cambia la volumetria (30 -> 60): el % se recalcula (25), los tickets se quedan (15)', ['25', '15'], [nueva.valor, nueva.tickets]);
    ed.capturarTickets(0, '10');
    Check('MV16 ligada en tickets: 10 de 100 = 10%, viaja como pct_valor', ['pct_valor', '10'],
      ed.paraEnviar().filter(function (p) { return p[0] === 'pct_valor'; })[0]);
    ed.capturarTickets(1, '61');
    Check('MV17 mas tickets que la volumetria: error local, no se envia', [false, true],
      [ed.revisar().listo, ed.erroresFormato().some(function (e) { return e.clave === 'tickets' && /más que la volumetría/.test(e.mensaje); })]);
    ed.capturarTickets(1, '');
    Check('MV18 tickets vacios: % vacio (sin meta), sin error de tickets', ['', false],
      [nueva.valor, ed.erroresFormato().some(function (e) { return e.clave === 'tickets'; })]);
    ed.capturarPct(1, '12.5');
    Check('MV19 volver a % (escribir el %): fuente pct, los tickets se derivan hacia abajo (12.5% de 60 = 7.5 -> 7)', ['pct', '7'],
      [nueva.fuente, ed.categorias.ticketsVista(nueva)]);
    var ed0 = new A.EdicionAdmin(Ini('PRB 2026-000191', { categorias: [] }), { rutas: ['/Z'] });
    ed0.categorias.agregar('/Z');
    ed0.categorias.filas[0].volCalc = 0;
    ed0.capturarTickets(0, '3');
    Check('MV20 volumetria 0: tickets -> % se rechaza (usa el %)', true,
      ed0.erroresFormato().some(function (e) { return /volumetría 0/.test(e.mensaje); }));
  });
});

// MW) Registro (ADM): "Planear la meta por" y la casilla de tickets de
//     Modificar por el DOM; Quitar sin sql/24 no llega al servidor.
pruebas.push(function () {
  var p = Pagina();
  return esperar().then(function () {
    var reg = p.registro, pg = p.pagina;
    pg.fijarRol('ADM');
    reg.modificar('PRB 2026-000001');
    return esperar().then(esperar).then(function () { return reg; });
  }).then(function (reg) {
    var ed = reg.edicion;
    Check('MW1 Modificar pide la volumetria TOTAL (alcance=total)', true,
      p.pedidos.some(function (x) { return /volumetria\.ashx\?alcance=total&ruta=/.test(x.url); }));
    var radio = Elemento('m'); radio.setAttribute('data-edicion-modo', ''); radio.value = 'tickets'; radio.checked = true;
    p.sel('regDetCuerpo').disparar('change', { target: radio });
    Check('MW2 el radio cambia el modo y repinta con casillas de tickets', ['tickets', true],
      [ed.categorias.modo, /data-edicion-tickets="0"/.test(p.sel('regEdCats').innerHTML)]);
    var antes = p.sel('regEdCats').innerHTML;
    editar(p, 'data-edicion-tickets', '0', '209');
    Check('MW3 escribir tickets: % derivado (209 / 418 = 50%), sin repintar la tabla (la casilla no se pisa)', ['50', '209', true],
      [ed.categorias.filas[0].valor, ed.categorias.filas[0].tickets, p.sel('regEdCats').innerHTML === antes]);
    editar(p, 'data-edicion-tickets', '0', '100');
    Check('MW4 ... y es un cambio de % de la ligada (100 / 418 -> 23.93%, el menor que da 100)', true,
      ed.cambios().some(function (c) { return c.clave === 'pct' && /^23\.93 \(meta: 100 tickets\)$/.test(c.nuevo); }));
    // Quitar sin sql/24 (el registro de prueba no la trae): marcado a mano,
    // Guardar no envia nada y lo escrito se queda.
    ed.categorias.quitar(1);
    var antesPost = p.pedidos.filter(function (x) { return x.metodo === 'POST'; }).length;
    return reg.guardarEdicion().then(function () {
      Check('MW5 sin sql/24: Guardar con una ligada quitada no envia; avisa y conserva el borrador', [antesPost, true, true, '100'],
        [p.pedidos.filter(function (x) { return x.metodo === 'POST'; }).length, /sql\/24/.test(p.sel('regEdMsg').innerHTML),
         reg.edicion === ed, ed.categorias.filas[0].tickets]);
    });
  });
});

// ---------------------------------------------------------------------------
// SB) Crear: Subestado inicial (sql/27)
// ---------------------------------------------------------------------------
pruebas.push(function () {
  // Borrador sin DOM: omitido no viaja; elegido viaja; el Estado no cambia.
  var b = new A.BorradorAdmin(I.CatalogoIniciativas.desdeJson(CATALOGO));
  b.elegirTipo('PRB');
  b.capturar('estado', 'En Análisis');
  var claves = function (pares) { return pares.map(function (x) { return x[0]; }); };
  Check('SB1 sin elegir: subestado no viaja (la base guarda NULL, como hoy)', false, claves(b.paraEnviar()).indexOf('subestado') >= 0);
  b.capturar('subestado', '  Solucionado ');
  var envio = {};
  b.paraEnviar().forEach(function (c) { envio[c[0]] = c[1]; });
  Check('SB2 elegido: viaja recortado y el Estado sigue siendo el elegido', ['Solucionado', 'En Análisis'], [envio.subestado, envio.estado]);
  Check('SB3 el Subestado no es faltante de Incompleta', false, b.faltantes().some(function (f) { return f.clave === 'subestado'; }));
  b.capturar('subestado', '');
  Check('SB4 volver a vacio: deja de viajar', false, claves(b.paraEnviar()).indexOf('subestado') >= 0);

  // Pantalla SIN sql/27: el campo no se ofrece.
  REGISTRO.subestados_problem = ['Cancelado', 'Solucionado'];
  var p = Pagina(), p2;
  return esperar().then(function () {
    var pg = p.pagina;
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    elegir(p, 'admTipo', 'PRB');
    Check('SB5 sin sql/27: el campo esta oculto y sin opciones', [true, []], [p.sel('admSubestadoCampo').hidden, p.sel('admSubestado').opciones()]);
    elegir(p, 'admSubestado', 'Solucionado');
    Check('SB6 sin sql/27: aunque llegue un change, no viaja', false,
      pg.crearAdmin.borrador.paraEnviar().some(function (x) { return x[0] === 'subestado'; }));
    // Pantalla CON sql/27.
    REGISTRO.subestado_alta = true;
    p2 = Pagina();
    return esperar();
  }).then(function () {
    delete REGISTRO.subestado_alta;
    delete REGISTRO.subestados_problem;
    var pg = p2.pagina;
    pg.fijarRol('ADM');
    pg.mostrarVista('crear');
    elegir(p2, 'admTipo', 'PRB');
    Check('SB7 con sql/27: visible, opciones = subestados_problem, Estado intacto', [false, ['Cancelado', 'Solucionado'], false, ['Cerrado', 'En Análisis', 'En Solución']],
      [p2.sel('admSubestadoCampo').hidden, p2.sel('admSubestado').opciones(), p2.sel('admSubestado').disabled, p2.sel('admEstado').opciones()]);
    elegir(p2, 'admEstado', 'En Solución');
    elegir(p2, 'admSubestado', 'Cancelado');
    var envio2 = {};
    pg.crearAdmin.borrador.paraEnviar().forEach(function (c) { envio2[c[0]] = c[1]; });
    Check('SB8 elegir Subestado: viaja y el Estado sigue siendo el elegido (no se deriva ni se reemplaza)', ['Cancelado', 'En Solución'],
      [envio2.subestado, envio2.estado]);
    Check('SB9 el selector de Estado no cambio al elegir Subestado', 'En Solución', p2.sel('admEstado').value);
  });
});

// ---------------------------------------------------------------------------
// HJ) Solo hojas: el servidor (CatalogoRutasIniciativa.Hojas) ya no manda
//     carpetas en rutas / rutas_adm. Una iniciativa que YA tiene ligada una
//     carpeta se abre y se edita sin reasignarla ni volver a ofrecerla.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var carpeta = '/S-Datos-Maestros/Centros/Catalogación';
  var hojas = [carpeta + '/Agregar Centros en Surtidos', carpeta + '/Catalogación no reflejada', '/A/Cat 2'];
  var ini = Ini('PRB 2026-000077', { categorias: [Cat(carpeta, 0.3), Cat('/A/Cat 2', 0.1)] });
  var ed = new A.EdicionAdmin(ini, { rutas: hojas, pos: ['PO 1'], sos: ['SO x'] });
  var h = A.htmlCategoriasEdicion(ed, null);
  Check('HJ1 la carpeta ligada se ve en Modificar con su valor guardado', [true, carpeta],
    [h.indexOf(carpeta) >= 0, ed.categorias.filas[0].categoria]);
  Check('HJ2 el desplegable de agregar solo ofrece las hojas del catalogo (la carpeta no es opcion)', [false, true],
    [h.indexOf('<option value="' + carpeta + '"') >= 0, h.indexOf('<option value="' + hojas[0] + '"') >= 0]);
  Check('HJ3 elegir la carpeta a mano no se acepta; una hoja si', [false, true],
    [ed.categorias.agregar(carpeta).ok, ed.categorias.agregar(hojas[0]).ok]);
  ed.categorias.quitar(2);
  ed.capturar('titulo', 'Titulo nuevo');
  var envio = ed.paraEnviar();
  Check('HJ4 cambiar solo el Titulo: no viaja nada de categorias (la carpeta no se toca)', [['accion', 'modificar'], ['folio', 'PRB 2026-000077'], ['titulo', 'Titulo nuevo']],
    envio);
  ed.categorias.capturarPct(0, '40');
  Check('HJ5 su % sigue editable y viaja con la ruta guardada, tal cual', ['pct_categoria', carpeta],
    ed.paraEnviar().filter(function (p) { return p[0] === 'pct_categoria'; })[0]);
});

pruebas.reduce(function (cadena, prueba) { return cadena.then(prueba); }, Promise.resolve())
  .then(function () {
    console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
    process.exit(fallos ? 1 : 0);
  }, function (err) {
    console.log('ERROR ' + (err && err.stack || err));
    process.exit(1);
  });
