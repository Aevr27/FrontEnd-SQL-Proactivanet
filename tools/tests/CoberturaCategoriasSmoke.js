// tools/tests/CoberturaCategoriasSmoke.js - prueba de humo de la Cobertura de
// categorias (vista secundaria de Iniciativas, admin/registro-iniciativas.js:
// Cobertura + VistaRegistro) sobre un DOM de mentira y un `pedir` propio.
//
// NO forma parte del sitio: vive fuera de admin/.
//
// Partes:
//   P) Perezosa: el registro carga sin pedir nada de Cobertura; se pide al
//      abrirla, una sola vez; volver al Registro y reabrir no repite.
//   A) Abre: conmutador, secciones, estados cargando / error / 403 /
//      reintento; cargando y error no se ven como "todo sin iniciativa".
//   C) Calculo sin filtros: con / sin iniciativa activa, solo `seguimiento`
//      cuenta (cerrada y agrupacion fuera no cubren), varias iniciativas en
//      una categoria sin escoger una, rutas fuera del catalogo aparte, sin
//      categoria solo contadas, omitidas del servidor.
//   F) Filtros compartidos: Director, PO, SO, Categoria (ruta y N2), Tipo de
//      iniciativa, Estado; el catalogo se suma a la cascada (Director solo
//      del catalogo); filtro "Cobertura" con / sin.
//   R) El registro no cambia: mismas iniciativas para las mismas selecciones
//      antes y despues de cargar la Cobertura; el detalle se abre desde ella.
//   S) Estilos: sin desborde horizontal (celdas que se parten, tarjetas bajo
//      760px que no fijan ancho).
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\CoberturaCategoriasSmoke.js   # sale 0 si todo paso
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
// DOM de mentira (el de RegistroIniciativasSmoke.js)
// ---------------------------------------------------------------------------
function Elemento(id) {
  var oyentes = {}, clases = {}, atributos = {};
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
      while ((m = re.exec(this.innerHTML))) if (m[1] !== '') salida.push(m[1].replace(/&amp;/g, '&'));
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
  return doc;
}
function Respuesta(status, cuerpo) {
  return {
    ok: status >= 200 && status < 300, status: status,
    json: function () {
      return typeof cuerpo === 'string' ? Promise.reject(new SyntaxError('no json')) : Promise.resolve(cuerpo);
    }
  };
}
function nunca() { return new Promise(function () {}); }
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }
function copia(x) { return JSON.parse(JSON.stringify(x)); }

// ---------------------------------------------------------------------------
// Datos
// ---------------------------------------------------------------------------
function Ini(folio, o) {
  var i = {
    folio: folio, titulo: 'T ' + folio, titulo_problem: 'T ' + folio, agrup: 'Problem', estado: 'En Análisis',
    tickets_reduce: 0, vol_reduce_folio: 0, riesgo_folio: 0, retrazado: 0, sem_fecha: 'ambar',
    fecha_retrasada: false, f_analisis: '2026-12-01', f_solucion: null, f_cierre: null,
    n_analisis: 0, n_solucion: 0, n_cierre: 0, antiguedad: 10, po: null, so: null, director: null,
    manager: null, descripcion: 'Desc ' + folio, observaciones: null,
    activa: true, seguimiento: true, sin_categoria: false, tipo_iniciativa: 'Problema', categorias: []
  };
  Object.keys(o || {}).forEach(function (k) { i[k] = o[k]; });
  return i;
}
function Cat(ruta, n2, dir, po, so) {
  return { categoria: ruta, n2: n2, tickets_reduce: 1, pct_dism: 0.1, director: dir, po: po, so: so };
}

var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'],
  agrupadores: ['Problem', 'SorIA', 'Adopcion', 'Mejora'],
  fecha_gen: '02/10/2026',
  iniciativas: [
    Ini('PRB 1', { estado: 'En Solución', categorias: [
      Cat('/A/Cat 1/Hoja', '/A/Cat 1', 'Dir A', 'PO 1', 'SO x'),
      Cat('/A/Cat 3', '/A/Cat 3', 'Dir A', 'PO 2', 'SO x')] }),
    // Segunda iniciativa activa en /A/Cat 1, por OTRA ruta: no se escoge una.
    Ini('MAP 6', { agrup: 'Mejora', tipo_iniciativa: 'Mejora continua', categorias: [
      Cat('/A/Cat 1/Otra', '/A/Cat 1', 'Dir A', 'PO 1', 'SO x'),
      Cat('/A/Cat 1', '/A/Cat 1', 'Dir A', 'PO 1', 'SO x')] }),
    Ini('MAP 2', { agrup: 'Mejora', tipo_iniciativa: 'Mejora continua', categorias: [
      Cat('/A/Cat 2', '/A/Cat 2', 'Dir A', 'PO 1', 'SO y')] }),
    // Cerrada: no cubre.
    Ini('HAR 3', { estado: 'Cerrado', activa: false, seguimiento: false, sem_fecha: 'verde', categorias: [
      Cat('/B/Cat 4', '/B/Cat 4', 'Dir B', 'PO 3', 'SO z')] }),
    // Activa con agrupacion fuera de las cuatro: no es `seguimiento`, no cubre.
    Ini('REQ 4', { agrup: 'ReqOpr', seguimiento: false, tipo_iniciativa: 'Requerimiento', categorias: [
      Cat('/B/Cat 5', '/B/Cat 5', 'Dir B', 'PO 3', 'SO z')] }),
    // Activa sin categoria: no cubre nada, se cuenta.
    Ini('PRB 5', { sin_categoria: true, po: 'PO 1', so: 'SO w', director: 'Dir B', categorias: [] }),
    // Activa con ruta cuyo C1&C2 no tiene N2 propia: fuera del catalogo.
    Ini('PRB 7', { categorias: [Cat('/D/Sin N2/X', null, 'Dir A', 'PO 1', 'SO x')] }),
    // Activa bajo una N2 que existe pero ya no esta vigente: tambien fuera.
    Ini('PRB 8', { categorias: [Cat('/E/Baja/Y', '/E/Baja', 'Dir B', 'PO 3', 'SO z')] })
  ]
};

var CATALOGO = {
  tipos: ['Problema', 'Mejora continua'],
  asignaciones: [
    { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' },
    { director: 'Dir A', po: 'PO 1', so: 'SO y', categoria: '/A/Cat 2' },
    { director: 'Dir A', po: 'PO 2', so: 'SO x', categoria: '/A/Cat 3' },
    { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 4' },
    { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 5' },
    // Sin ninguna iniciativa: su Director, PO y SO solo existen en el catalogo.
    { director: 'Dir C', po: 'PO 9', so: 'SO q', categoria: '/C/Sola' },
    { director: 'Dir C', po: 'PO 9', so: 'SO q' }          // invalida: se descarta
  ],
  omitidas: 2
};

// La pagina completa. Cada pedido se anota: la de Nueva solicitud
// (iniciativas.js) va al mismo handler, por eso se cuenta aparte.
function Pagina(respCatalogo) {
  var ventana = Elemento('window');
  var documento = Documento();
  var pedidos = [];
  function pedir(url) {
    pedidos.push(url);
    if (/registro/.test(url)) return Promise.resolve(Respuesta(200, copia(REGISTRO)));
    return respCatalogo(url);
  }
  (new Function('window', leer('assets/js/escape.js')))(ventana);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(ventana, ventana.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(ventana, documento);
  (new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'fetch', leer('admin/registro-iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, pedir);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.GloboAyuda, pedir);
  var vista = ventana.IniciativasPagina.registro;
  return {
    ventana: ventana, doc: documento, vista: vista, pedidos: pedidos,
    sel: function (id) { return documento.getElementById(id); },
    catalogoPedidos: function () { return pedidos.filter(function (u) { return /catalogos/.test(u); }).length; }
  };
}
function catOk() { return Promise.resolve(Respuesta(200, copia(CATALOGO))); }

// Filas pintadas de la Cobertura: [categoria, con|sin, [folios]]
function filasCob(p) {
  var html = p.sel('covCuerpo').innerHTML, salida = [];
  html.split('<tr ').slice(1).forEach(function (tr) {
    var cat = (tr.match(/data-col="Categoría"[^>]*>([^<]*)</) || [])[1];
    var estado = /Con iniciativa activa/.test(tr) ? 'con' : 'sin';
    var folios = [], re = /data-folio="([^"]+)"/g, m;
    while ((m = re.exec(tr))) folios.push(m[1]);
    salida.push([cat, estado, folios]);
  });
  return salida;
}
function categoriasCob(p) { return filasCob(p).map(function (f) { return f[0]; }); }
function folios(p) {
  var re = /<tr class="ini-fila[^"]*" data-folio="([^"]+)"/g, m, s = [];
  while ((m = re.exec(p.sel('regCuerpo').innerHTML))) s.push(m[1]);
  return s;
}
function elegir(p, id, v) { p.sel(id).value = v; p.sel(id).disparar('change'); }
function visiblesCob(p) {
  return ['covCargando', 'covError', 'covContenido'].filter(function (id) { return !p.sel(id).hidden; });
}

var pruebas = [];

// ---------------------------------------------------------------------------
// P / A) Perezosa y apertura
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var p = Pagina(catOk);
  return esperar().then(function () {
    // Nueva solicitud pide el catalogo al iniciar la pagina; la Cobertura no.
    var alIniciar = p.catalogoPedidos();
    Check('P1 registro cargado', 8, p.vista.registro.iniciativas.length);
    Check('P1 Cobertura no pidio nada al cargar', [null, 1], [p.vista.cobertura, alIniciar]);
    Check('P1 vista inicial: Registro', [false, true, 'true', 'false'],
      [p.sel('regListaBloque').hidden, p.sel('covSeccion').hidden,
       p.sel('regVerRegistro').getAttribute('aria-pressed'), p.sel('regVerCobertura').getAttribute('aria-pressed')]);
    Check('P1 el registro no trae opciones del catalogo', false, p.vista.registro.directores().indexOf('Dir C') >= 0);

    p.sel('regVerCobertura').disparar('click');
    Check('A1 abre: cargando, sin contenido', ['covCargando'], visiblesCob(p));
    Check('A1 conmutador', [true, false, 'false', 'true'],
      [p.sel('regListaBloque').hidden, p.sel('covSeccion').hidden,
       p.sel('regVerRegistro').getAttribute('aria-pressed'), p.sel('regVerCobertura').getAttribute('aria-pressed')]);
    return esperar().then(function () {
      Check('P2 un pedido al abrir', alIniciar + 1, p.catalogoPedidos());
      Check('A2 listo', ['covContenido'], visiblesCob(p));
      p.sel('regVerRegistro').disparar('click');
      Check('A3 volver al Registro', [false, true], [p.sel('regListaBloque').hidden, p.sel('covSeccion').hidden]);
      p.sel('regVerCobertura').disparar('click');
      return esperar();
    }).then(function () {
      Check('P3 reabrir no vuelve a pedir', alIniciar + 1, p.catalogoPedidos());
      Check('P3 reabrir pinta', 6, filasCob(p).length);
    });
  });
});

pruebas.push(function () {
  // Dos clics seguidos mientras carga: un solo pedido.
  var resolver;
  var p = Pagina(function () { return new Promise(function (ok) { resolver = ok; }); });
  return esperar().then(function () {
    var antes = p.catalogoPedidos();
    p.vista.verCobertura();
    p.vista.verCobertura();
    return esperar().then(function () {
      Check('P4 doble clic en vuelo: un pedido', antes + 1, p.catalogoPedidos());
      p.vista.verCobertura();
      return esperar();
    }).then(function () {
      Check('P4 tercer clic aun en vuelo: sigue uno', antes + 1, p.catalogoPedidos());
      resolver(Respuesta(200, copia(CATALOGO)));
      return esperar().then(esperar);
    });
  }).then(function () {
    Check('P4 termina listo', ['covContenido'], visiblesCob(p));
  });
});

pruebas.push(function () {
  var veces = 0;
  var p = Pagina(function () {
    veces++;
    // 1: Nueva solicitud; 2: Cobertura con 500; 3: reintento bueno.
    if (veces === 2) return Promise.resolve(Respuesta(500, { error: 'falla X', tipo: 'SqlException' }));
    return catOk();
  });
  return esperar().then(function () { return p.vista.verCobertura(); }).then(function () {
    Check('A4 error 500: solo el error, con el mensaje', [['covError'], 'falla X', ''],
      [visiblesCob(p), p.sel('covErrorTexto').textContent, p.sel('covCuerpo').innerHTML]);
    p.sel('covReintentar').disparar('click');
    return esperar().then(esperar);
  }).then(function () {
    Check('A5 reintento', ['covContenido'], visiblesCob(p));
  });
});

pruebas.push(function () {
  // Sin autorizacion: el handler responde 403 (AccesoAdmin.Exigir) y la vista
  // no inventa nada.
  var p = Pagina(function () {
    return Promise.resolve(Respuesta(403, { error: 'No tienes acceso a la administracion de iniciativas.', tipo: 'AccesoDenegado' }));
  });
  return esperar().then(function () { return p.vista.verCobertura(); }).then(function () {
    Check('A6 403: error con el mensaje del servidor, sin filas', [['covError'], 'No tienes acceso a la administracion de iniciativas.', null],
      [visiblesCob(p), p.sel('covErrorTexto').textContent, p.vista.cobertura]);
  });
});

pruebas.push(function () {
  var p = Pagina(function () { return Promise.reject(new Error('red')); });
  return esperar().then(function () { return p.vista.verCobertura(); }).then(function () {
    Check('A7 red caida', [['covError'], 'No se pudo conectar con el servidor.'],
      [visiblesCob(p), p.sel('covErrorTexto').textContent]);
  });
});

pruebas.push(function () {
  var p = Pagina(function () { return Promise.resolve(Respuesta(200, { tipos: [] })); });
  return esperar().then(function () { return p.vista.verCobertura(); }).then(function () {
    Check('A8 respuesta sin lista: error, no "todo sin iniciativa"', ['covError'], visiblesCob(p));
  });
});

// ---------------------------------------------------------------------------
// C / F / R) Calculo, filtros y registro intacto
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var p = Pagina(catOk);
  var antes = {};
  return esperar().then(function () {
    // Registro ANTES de cargar la Cobertura, para comparar despues.
    elegir(p, 'regDirector', 'Dir A'); antes.dirA = folios(p).slice().sort();
    elegir(p, 'regPo', 'PO 1'); antes.po1 = folios(p).slice().sort();
    elegir(p, 'regCategoria', '/A/Cat 1/Hoja'); antes.ruta = folios(p).slice().sort();
    p.sel('regLimpiar').disparar('click'); antes.todo = folios(p).slice().sort();
    return p.vista.verCobertura();
  }).then(function () {
    var f = filasCob(p);
    Check('C1 todas las categorias vigentes del catalogo, en orden; la invalida fuera',
      ['/A/Cat 1', '/A/Cat 2', '/A/Cat 3', '/B/Cat 4', '/B/Cat 5', '/C/Sola'], categoriasCob(p));
    Check('C2 con / sin iniciativa activa', ['con', 'con', 'con', 'sin', 'sin', 'sin'], f.map(function (x) { return x[1]; }));
    Check('C3 cerrada y agrupacion fuera no cubren', [[], []], [f[3][2], f[4][2]]);
    Check('C4 varias iniciativas: todas, sin escoger', ['MAP 6', 'PRB 1'], f[0][2]);
    Check('C4 se dice cuantas', true, /2 iniciativas activas/.test(p.sel('covCuerpo').innerHTML));
    Check('C4 la ruta de cada una se ve (no se pierde)', [true, true],
      [/\/A\/Cat 1\/Hoja/.test(p.sel('covCuerpo').innerHTML), /\/A\/Cat 1\/Otra/.test(p.sel('covCuerpo').innerHTML)]);
    Check('C5 sin iniciativa: lo dice', true, /<span class="pill vencido">Sin iniciativa activa<\/span>/.test(p.sel('covCuerpo').innerHTML));
    Check('C6 cuenta', '6 categorías · 3 con iniciativa activa · 3 sin iniciativa activa', p.sel('covCuenta').textContent);
    var fuera = p.sel('covFuera');
    Check('C7 rutas fuera del catalogo vigente, aparte', [false, true, true, true],
      [fuera.hidden, /\/D\/Sin N2\/X/.test(fuera.innerHTML), /\/E\/Baja\/Y/.test(fuera.innerHTML), /\(2 rutas\)/.test(fuera.innerHTML)]);
    Check('C7 ... y no son filas de cobertura', false, /\/D\/Sin N2|\/E\/Baja/.test(p.sel('covCuerpo').innerHTML));
    var nota = p.sel('covNota').textContent;
    Check('C8 nota: omitidas y sin categoria', [true, true],
      [/2 categorías vigentes no aparecen/.test(nota), /1 iniciativa activa no tiene categoría/.test(nota)]);
    Check('C9 sin volumen de tickets', false, /tickets_reduce|vol_|Volumen/.test(p.sel('covCuerpo').innerHTML));

    // F) Filtros compartidos
    Check('F1 el catalogo se suma a la cascada: Dir C', true, p.sel('regDirector').opciones().indexOf('Dir C') >= 0);
    elegir(p, 'regDirector', 'Dir B');
    Check('F2 Director', ['/B/Cat 4', '/B/Cat 5'], categoriasCob(p));
    Check('F2 Director: fuera de catalogo tambien filtra', [true, false],
      [/\/E\/Baja\/Y/.test(p.sel('covFuera').innerHTML), /\/D\/Sin N2/.test(p.sel('covFuera').innerHTML)]);
    elegir(p, 'regDirector', 'Dir C');
    Check('F2 Director solo del catalogo', [['/C/Sola', 'sin', []]], filasCob(p));
    Check('F2 ... y el registro queda vacio, no roto', [], folios(p));
    elegir(p, 'regDirector', '');
    elegir(p, 'regPo', 'PO 2');
    Check('F3 Product Owner', ['/A/Cat 3'], categoriasCob(p));
    elegir(p, 'regPo', '');
    elegir(p, 'regSo', 'SO y');
    Check('F4 Service Owner', ['/A/Cat 2'], categoriasCob(p));
    elegir(p, 'regSo', '');
    elegir(p, 'regCategoria', '/A/Cat 1/Hoja');
    Check('F5 Categoria = ruta: su N2', [['/A/Cat 1', 'con', ['MAP 6', 'PRB 1']]], filasCob(p));
    elegir(p, 'regCategoria', '/A/Cat 1');
    Check('F5 Categoria = N2 del catalogo', ['/A/Cat 1'], categoriasCob(p));
    Check('F5 ... el registro trae lo que cuelga de ella', ['MAP 6', 'PRB 1'], folios(p).slice().sort());
    elegir(p, 'regCategoria', '/C/Sola');
    Check('F5 Categoria sin iniciativas (solo catalogo)', [['/C/Sola', 'sin', []]], filasCob(p));
    elegir(p, 'regCategoria', '');

    // Tipo de iniciativa: solo cuentan las del tipo elegido.
    p.sel('regTipoIniPanel').disparar('change', { target: (function () {
      var el = Elemento('c'); el.setAttribute('data-tipo-ini', 'Problema'); return el; })() });
    p.sel('regTipoIniPanel').disparar('change', { target: (function () {
      var el = Elemento('c'); el.setAttribute('data-tipo-ini', 'Requerimiento'); return el; })() });
    // Desde "Todas", desmarcar dos deja solo Mejora continua.
    var marcados = p.vista.filtro.tiposIniciativa();
    Check('F6 tipos marcados', ['Mejora continua'], marcados);
    var f6 = filasCob(p);
    Check('F6 Tipo: /A/Cat 1 solo por MAP 6; /A/Cat 3 queda sin', [['MAP 6'], 'sin'],
      [f6[0][2], f6[2][1]]);
    p.vista.filtro.todosTiposIniciativa(); p.vista.refrescar();

    elegir(p, 'regEstadoSel', 'En Solución');
    Check('F7 Estado: solo cuentan las de ese estado', ['con', 'sin', 'con'],
      filasCob(p).slice(0, 3).map(function (x) { return x[1]; }));
    elegir(p, 'regEstadoSel', '');

    elegir(p, 'covFiltro', 'sin');
    Check('F8 filtro Cobertura: sin', ['/B/Cat 4', '/B/Cat 5', '/C/Sola'], categoriasCob(p));
    elegir(p, 'covFiltro', 'con');
    Check('F8 filtro Cobertura: con', ['/A/Cat 1', '/A/Cat 2', '/A/Cat 3'], categoriasCob(p));
    elegir(p, 'regDirector', 'Dir C');
    Check('F9 nada coincide: vacio, no tabla', [false, true], [p.sel('covVacio').hidden, p.sel('covTablaCaja').hidden]);
    elegir(p, 'regDirector', '');
    elegir(p, 'covFiltro', '');

    // R) Registro con las mismas selecciones de antes.
    p.sel('regLimpiar').disparar('click');
    Check('R1 sin filtros: igual', antes.todo, folios(p).slice().sort());
    elegir(p, 'regDirector', 'Dir A');
    Check('R1 Dir A: igual', antes.dirA, folios(p).slice().sort());
    elegir(p, 'regPo', 'PO 1');
    Check('R1 Dir A + PO 1: igual', antes.po1, folios(p).slice().sort());
    elegir(p, 'regCategoria', '/A/Cat 1/Hoja');
    Check('R1 ruta: igual', antes.ruta, folios(p).slice().sort());
    p.sel('regLimpiar').disparar('click');

    // Detalle desde la Cobertura.
    var boton = Elemento('b'); boton.setAttribute('data-folio', 'MAP 6');
    p.sel('covCuerpo').disparar('click', { target: boton });
    Check('R2 el folio abre el detalle de siempre', ['MAP 6', false], [p.sel('regDetTitulo').textContent, p.sel('regDetalle').hidden]);
    p.vista.cerrarDetalle();
    Check('R2 el foco vuelve al folio', 1, boton.enfocado);
  });
});

pruebas.push(function () {
  // Recargar el registro descarta la Cobertura y la vista vuelve al Registro.
  var p = Pagina(catOk);
  return esperar().then(function () { return p.vista.verCobertura(); }).then(function () {
    p.vista.cargar(function (url) { return Promise.resolve(Respuesta(200, copia(REGISTRO))); });
    Check('R3 recarga: vuelve al Registro sin Cobertura', ['registro', null, true],
      [p.vista.modo, p.vista.cobertura, p.sel('covSeccion').hidden]);
    return esperar();
  }).then(function () {
    Check('R3 ... y el registro ya no trae el catalogo', false, p.vista.registro.directores().indexOf('Dir C') >= 0);
  });
});

// ---------------------------------------------------------------------------
// S) Estilos: nada fija un ancho que desborde
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var css = leer('admin/iniciativas.css');
  function regla(sel) {
    var i = css.indexOf('\n' + sel + ' {');
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i));
  }
  var movil = css.slice(css.indexOf('@media (max-width: 760px)'));
  movil = movil.slice(0, movil.indexOf('\n}'));
  Check('S1 la tabla de cobertura vive en la caja con scroll propio', true,
    /<div class="ini-tabla-caja" id="covTablaCaja">/.test(leer('admin/iniciativas.html')));
  Check('S2 rutas y titulos se parten', [true, true],
    [/overflow-wrap: anywhere/.test(regla('.ini-cat-ruta')), /overflow-wrap: anywhere/.test(regla('.ini-cov-lista li'))]);
  Check('S3 bajo 760px: tarjetas, iniciativas a todo lo ancho, campo al 100%', [true, true, true],
    [/td \{ display: block; padding: 0; border: 0; max-width: none; min-width: 0;/.test(movil),
     /td\.ini-cov-inis \{ grid-column: 1 \/ -1; \}/.test(movil), /\.ini-cov-campo \{ margin-left: 0; width: 100%; \}/.test(movil)]);
  Check('S4 el conmutador se parte y no pasa del ancho', [true, true],
    [/flex-wrap: wrap/.test(regla('.ini-conmutador')), /max-width: 100%/.test(regla('.ini-conmutador'))]);
  Check('S5 el select de Cobertura no fija ancho', [true, false],
    [/max-width: 100%/.test(regla('.ini-cov-campo select')), /(^|[ ;{])width:/.test(regla('.ini-cov-campo select'))]);
});

pruebas.reduce(function (p, f) { return p.then(f); }, Promise.resolve()).then(function () {
  console.log(fallos === 0 ? '\nTODO PASO' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
}, function (e) {
  console.error(e);
  process.exit(1);
});
