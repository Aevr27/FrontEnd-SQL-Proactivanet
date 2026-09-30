// tools/tests/IniciativasCascadaSmoke.js - prueba de humo de los selects
// encadenados de admin/iniciativas.html (Director -> Product Owner ->
// Service Owner -> Categoria).
//
// NO forma parte del sitio: vive fuera de admin/, asi que ni IIS ni el
// navegador la cargan nunca.
//
// Dos partes:
//   A) IniciativasCascada, la logica pura: opciones por nivel, reseteo de los
//      hijos al cambiar un padre, valores fuera de catalogo, motivos de
//      bloqueo y el hijo sin valores.
//   B) IniciativasPagina sobre un DOM de mentira con un `pedir` propio:
//      carga correcta, error 500 con {error}, fallo de red, respuesta que no
//      es JSON, catalogo vacio, nota de omitidas y una carga vieja que llega
//      tarde.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\IniciativasCascadaSmoke.js   # sale 0 si todo paso
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
// DOM de mentira: solo lo que toca iniciativas.js
// ---------------------------------------------------------------------------
function Elemento(id) {
  var oyentes = {};
  return {
    id: id, textContent: '', hidden: false, innerHTML: '', value: '', disabled: false,
    addEventListener: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    disparar: function (tipo) {
      var self = this;
      (oyentes[tipo] || []).forEach(function (fn) { fn({ target: self }); });
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
  return {
    readyState: 'complete',
    getElementById: function (id) { return els[id] || (els[id] = Elemento(id)); },
    querySelectorAll: function () { return []; },
    addEventListener: function () {}
  };
}

// Carga los tres scripts en una "ventana" nueva con su documento y su fetch.
function Pagina(pedir) {
  var ventana = {};
  var documento = Documento();
  (new Function('window', leer('assets/js/escape.js')))(ventana);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(ventana, ventana.Escape);
  (new Function('window', 'document', 'Catalogos', 'fetch', leer('admin/iniciativas.js')))(
    ventana, documento, ventana.Catalogos, pedir);
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

var FILAS = [
  { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' },
  { director: 'Dir A', po: 'PO 1', so: 'SO y', categoria: '/A/Cat 2' },
  { director: 'Dir A', po: 'PO 2', so: 'SO x', categoria: '/A/Cat 3' },
  { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 4' },
  { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 5' },
  { director: 'Dir B', po: 'PO 1', so: 'SO w', categoria: '/B/Cat 6' }   // PO 1 con dos directores
];

// ---------------------------------------------------------------------------
// A) Logica pura
// ---------------------------------------------------------------------------
var base = Pagina(function () { return new Promise(function () {}); });
var C = base.ventana.IniciativasCascada;

var s = C.seleccionVacia();
var e = C.estado(FILAS, s);
Check('A1 inicial: solo Director habilitado', [true, false, false, false], e.map(function (x) { return x.habilitado; }));
Check('A1 inicial: directores', ['Dir A', 'Dir B'], e[0].opciones);
Check('A1 inicial: motivo PO', 'Elige primero un Director.', e[1].motivo);
Check('A1 inicial: motivo SO', 'Elige primero un Product Owner.', e[2].motivo);
Check('A1 inicial: motivo Categoria', 'Elige primero un Service Owner.', e[3].motivo);

s = C.elegir(FILAS, s, 0, 'Dir A');
Check('A2 Dir A: POs', ['PO 1', 'PO 2'], C.estado(FILAS, s)[1].opciones);
s = C.elegir(FILAS, s, 1, 'PO 1');
Check('A2 Dir A/PO 1: SOs (sin SO w de Dir B)', ['SO x', 'SO y'], C.estado(FILAS, s)[2].opciones);
s = C.elegir(FILAS, s, 2, 'SO x');
Check('A2 Dir A/PO 1/SO x: categorias', ['/A/Cat 1'], C.estado(FILAS, s)[3].opciones);
s = C.elegir(FILAS, s, 3, '/A/Cat 1');
Check('A2 seleccion completa', ['Dir A', 'PO 1', 'SO x', '/A/Cat 1'], s);
Check('A2 todo habilitado', [true, true, true, true], C.estado(FILAS, s).map(function (x) { return x.habilitado; }));

var s2 = C.elegir(FILAS, s, 0, 'Dir B');
Check('A3 cambiar Director limpia los hijos', ['Dir B', '', '', ''], s2);
Check('A3 POs de Dir B', ['PO 1', 'PO 3'], C.estado(FILAS, s2)[1].opciones);
Check('A3 hijos bloqueados otra vez', [true, true, false, false], C.estado(FILAS, s2).map(function (x) { return x.habilitado; }));
var s3 = C.elegir(FILAS, s, 1, 'PO 2');
Check('A3 cambiar PO limpia SO y Categoria', ['Dir A', 'PO 2', '', ''], s3);
Check('A3 PO 1 bajo Dir B: solo SO w', ['SO w'], C.estado(FILAS, C.elegir(FILAS, s2, 1, 'PO 1'))[2].opciones);
Check('A3 volver a "— Elige —" limpia hacia abajo', ['Dir A', '', '', ''], C.elegir(FILAS, s, 1, ''));

Check('A4 valor fuera de catalogo no se acepta', ['Dir A', '', '', ''], C.elegir(FILAS, s, 1, 'PO 3'));
Check('A4 no muta la seleccion original', ['Dir A', 'PO 1', 'SO x', '/A/Cat 1'], s);

var huerfano = C.estado(FILAS, ['Dir Z', '', '', '']);
Check('A5 hijo sin valores: bloqueado', false, huerfano[1].habilitado);
Check('A5 hijo sin valores: motivo', 'Sin valores para el Director elegido.', huerfano[1].motivo);
Check('A5 catalogo vacio: Director bloqueado', 'Sin valores en el catálogo.', C.estado([], C.seleccionVacia())[0].motivo);

Check('A6 normalizar descarta filas incompletas', 1, C.normalizar({ asignaciones: [
  FILAS[0], { director: 'X', po: 'Y', so: '', categoria: 'Z' }, { director: 'X', po: 1, so: 'S', categoria: 'Z' }, null
] }).length);
var lanzo = false;
try { C.normalizar({ error: 'x' }); } catch (err) { lanzo = true; }
Check('A6 normalizar sin asignaciones lanza', true, lanzo);

// ---------------------------------------------------------------------------
// B) Pagina
// ---------------------------------------------------------------------------
function estadoSelects(p) {
  return ['selDirector', 'selPo', 'selSo', 'selCategoria'].map(function (id) {
    return { habilitado: !p.sel(id).disabled, opciones: p.sel(id).opciones() };
  });
}

var pruebas = [];

// B1 carga correcta + cascada con eventos change
pruebas.push(function () {
  var urls = [];
  var p = Pagina(function (url) { urls.push(url); return Promise.resolve(Respuesta(200, { asignaciones: FILAS, omitidas: 0 })); });
  Check('B1 cargando: todo bloqueado', [true, true, true, true], ['selDirector', 'selPo', 'selSo', 'selCategoria'].map(function (id) { return p.sel(id).disabled; }));
  Check('B1 cargando: mensaje', 'Cargando catálogo organizacional…', p.sel('iniEstado').textContent);
  return p.ventana.IniciativasPagina.cargar(function (url) { urls.push(url); return Promise.resolve(Respuesta(200, { asignaciones: FILAS, omitidas: 0 })); }).then(function () {
    Check('B1 URL del handler', '../handlers/admin_iniciativas_catalogos.ashx', urls[urls.length - 1]);
    var est = estadoSelects(p);
    Check('B1 cargado: solo Director habilitado', [true, false, false, false], est.map(function (x) { return x.habilitado; }));
    Check('B1 cargado: directores', ['Dir A', 'Dir B'], est[0].opciones);
    Check('B1 motivo PO visible', 'Elige primero un Director.', p.sel('motPo').textContent);
    Check('B1 sin error', true, p.sel('iniError').hidden);
    Check('B1 sin nota de omitidas', true, p.sel('iniOmitidas').hidden);

    p.sel('selDirector').value = 'Dir A'; p.sel('selDirector').disparar('change');
    p.sel('selPo').value = 'PO 1'; p.sel('selPo').disparar('change');
    p.sel('selSo').value = 'SO y'; p.sel('selSo').disparar('change');
    p.sel('selCategoria').value = '/A/Cat 2'; p.sel('selCategoria').disparar('change');
    Check('B1 cadena completa', ['Dir A', 'PO 1', 'SO y', '/A/Cat 2'],
      ['selDirector', 'selPo', 'selSo', 'selCategoria'].map(function (id) { return p.sel(id).value; }));
    Check('B1 motivos vacios', ['', '', '', ''], ['motDirector', 'motPo', 'motSo', 'motCategoria'].map(function (id) { return p.sel(id).textContent; }));

    p.sel('selDirector').value = 'Dir B'; p.sel('selDirector').disparar('change');
    Check('B1 cambiar Director: hijos vacios', ['Dir B', '', '', ''],
      ['selDirector', 'selPo', 'selSo', 'selCategoria'].map(function (id) { return p.sel(id).value; }));
    est = estadoSelects(p);
    Check('B1 cambiar Director: PO habilitado, SO/Cat bloqueados', [true, true, false, false], est.map(function (x) { return x.habilitado; }));
    Check('B1 cambiar Director: POs de Dir B', ['PO 1', 'PO 3'], est[1].opciones);
    Check('B1 cambiar Director: SO sin opciones viejas', [], est[2].opciones);
    Check('B1 cambiar Director: motivo SO', 'Elige primero un Product Owner.', p.sel('motSo').textContent);
  });
});

// B2 error 500 con {error}
pruebas.push(function () {
  var p = Pagina(function () { return new Promise(function () {}); });
  return p.ventana.IniciativasPagina.cargar(function () {
    return Promise.resolve(Respuesta(500, { error: 'El servidor de SQL rechazo la consulta (error 208).', tipo: 'SqlException' }));
  }).then(function () {
    Check('B2 500: error visible', false, p.sel('iniError').hidden);
    Check('B2 500: mensaje del servidor', 'El servidor de SQL rechazo la consulta (error 208).', p.sel('iniErrorTexto').textContent);
    Check('B2 500: todo bloqueado', [false, false, false, false], estadoSelects(p).map(function (x) { return x.habilitado; }));
    Check('B2 500: motivo', 'No disponible: no se pudo cargar el catálogo.', p.sel('motDirector').textContent);
    Check('B2 500: sin "Cargando"', '', p.sel('iniEstado').textContent);
  });
});

// B3 fallo de red, y reintento que si funciona
pruebas.push(function () {
  var p = Pagina(function () { return new Promise(function () {}); });
  return p.ventana.IniciativasPagina.cargar(function () { return Promise.reject(new TypeError('Failed to fetch')); }).then(function () {
    Check('B3 red: mensaje', 'No se pudo conectar con el servidor.', p.sel('iniErrorTexto').textContent);
    return p.ventana.IniciativasPagina.cargar(function () { return Promise.resolve(Respuesta(200, { asignaciones: FILAS, omitidas: 0 })); });
  }).then(function () {
    Check('B3 reintento: error oculto', true, p.sel('iniError').hidden);
    Check('B3 reintento: Director habilitado', true, !p.sel('selDirector').disabled);
  });
});

// B4 200 que no es JSON; 404 sin cuerpo JSON
pruebas.push(function () {
  var p = Pagina(function () { return new Promise(function () {}); });
  return p.ventana.IniciativasPagina.cargar(function () { return Promise.resolve(Respuesta(200, '<html>')); }).then(function () {
    Check('B4 no JSON: mensaje', 'La respuesta del servidor no trae el catálogo esperado.', p.sel('iniErrorTexto').textContent);
    return p.ventana.IniciativasPagina.cargar(function () { return Promise.resolve(Respuesta(404, '<html>')); });
  }).then(function () {
    Check('B4 404: mensaje', 'El servidor respondió 404.', p.sel('iniErrorTexto').textContent);
  });
});

// B5 catalogo vacio + omitidas
pruebas.push(function () {
  var p = Pagina(function () { return new Promise(function () {}); });
  return p.ventana.IniciativasPagina.cargar(function () { return Promise.resolve(Respuesta(200, { asignaciones: [], omitidas: 3 })); }).then(function () {
    Check('B5 vacio: mensaje', 'No hay categorías vigentes con Director, Product Owner y Service Owner.', p.sel('iniEstado').textContent);
    Check('B5 vacio: todo bloqueado', [false, false, false, false], estadoSelects(p).map(function (x) { return x.habilitado; }));
    Check('B5 vacio: no es error', true, p.sel('iniError').hidden);
    Check('B5 omitidas visible', false, p.sel('iniOmitidas').hidden);
    Check('B5 omitidas texto', '3 categorías vigentes no aparecen: les falta Director, Product Owner o Service Owner en el catálogo de dueños.', p.sel('iniOmitidas').textContent);
  });
});

// B6 una carga vieja que llega despues de la nueva no pisa el resultado
pruebas.push(function () {
  var p = Pagina(function () { return new Promise(function () {}); });
  var soltarVieja;
  var vieja = p.ventana.IniciativasPagina.cargar(function () {
    return new Promise(function (ok) { soltarVieja = ok; });
  });
  var nueva = p.ventana.IniciativasPagina.cargar(function () {
    return Promise.resolve(Respuesta(200, { asignaciones: FILAS, omitidas: 0 }));
  });
  return nueva.then(function () {
    soltarVieja(Respuesta(500, { error: 'vieja' }));
    return vieja;
  }).then(function () {
    Check('B6 carga vieja ignorada: sin error', true, p.sel('iniError').hidden);
    Check('B6 carga vieja ignorada: Director habilitado', true, !p.sel('selDirector').disabled);
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
