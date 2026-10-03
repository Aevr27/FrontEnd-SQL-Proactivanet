// tools/tests/CascadaOrganizacionalSmoke.js - prueba de humo de la cascada
// compartida de admin/ (admin/cascada-organizacional.js) en sus dos modos:
//
//   Product Owner -> Service Owner -> Categoria
//
// Partes:
//   C) modo 'creacion': lo mismo que usa "Nueva solicitud" (el detalle de la
//      pagina vive en IniciativasCascadaSmoke.js).
//   F) modo 'filtro': niveles opcionales, reseteo de los hijos, opciones que
//      se restauran al limpiar, filtros() para el servidor.
//   M) los dos modos comparten la regla: mismas opciones para la misma
//      seleccion; iniciativas.js no trae una cascada propia.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\CascadaOrganizacionalSmoke.js   # sale 0 si todo paso
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

var ventana = {};
(new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
var Cascada = ventana.CascadaOrganizacional;

// Mismo juego de filas que IniciativasCascadaSmoke.js (la forma del JSON de
// admin_iniciativas_catalogos.ashx).
var FILAS = [
  { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' },
  { director: 'Dir A', po: 'PO 1', so: 'SO y', categoria: '/A/Cat 2' },
  { director: 'Dir A', po: 'PO 2', so: 'SO x', categoria: '/A/Cat 3' },
  { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 4' },
  { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 5' },
  { director: 'Dir B', po: 'PO 1', so: 'SO w', categoria: '/B/Cat 6' }
];
var TODAS_CAT = ['/A/Cat 1', '/A/Cat 2', '/A/Cat 3', '/B/Cat 4', '/B/Cat 5', '/B/Cat 6'];
function hab(est) { return est.map(function (x) { return x.habilitado; }); }

// ---------------------------------------------------------------------------
// C) modo creacion
// ---------------------------------------------------------------------------
var c = new Cascada(FILAS);
Check('C1 modo por omision: creacion', 'creacion', c.modo);
Check('C1 creacion: solo PO habilitado', [true, false, false], hab(c.estado(true)));
c.elegir(0, 'PO 1');
Check('C2 PO limita SO', ['SO w', 'SO x', 'SO y'], c.opciones(1));
c.elegir(1, 'SO x');
Check('C2 PO + SO limita Categoria', ['/A/Cat 1'], c.opciones(2));
c.elegir(2, '/A/Cat 1');
Check('C2 Director derivado', 'Dir A', c.director());
var lanzo = false;
try { new Cascada(FILAS, 'otro'); } catch (err) { lanzo = true; }
Check('C3 modo desconocido lanza', true, lanzo);

// ---------------------------------------------------------------------------
// F) modo filtro
// ---------------------------------------------------------------------------
var f = new Cascada(FILAS, 'filtro');
var e = f.estado(true);
Check('F1 sin nada elegido: los tres niveles habilitados', [true, true, true], hab(e));
Check('F1 SO sin PO: todos los SO', ['SO w', 'SO x', 'SO y', 'SO z'], e[1].opciones);
Check('F1 Categoria sin PO ni SO: todas', TODAS_CAT, e[2].opciones);
Check('F1 sin filtros', {}, f.filtros());

f.elegir(0, 'PO 1');
e = f.estado(true);
Check('F2 PO limita SO', ['SO w', 'SO x', 'SO y'], e[1].opciones);
Check('F2 PO sin SO: solo categorias del PO', ['/A/Cat 1', '/A/Cat 2', '/B/Cat 6'], e[2].opciones);
Check('F2 PO 1 no ofrece SO de otro PO', false, e[1].opciones.indexOf('SO z') >= 0);
Check('F2 filtros: solo PO', { po: 'PO 1' }, f.filtros());

f.elegir(1, 'SO x');
Check('F3 PO + SO: solo categorias validas', ['/A/Cat 1'], f.estado(true)[2].opciones);
Check('F3 PO + SO no ofrece Cat 3 (SO x de otro PO)', false, f.opciones(2).indexOf('/A/Cat 3') >= 0);
f.elegir(2, '/A/Cat 1');
Check('F3 filtros completos', { po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' }, f.filtros());

f.elegir(2, '');
Check('F4 limpiar Categoria conserva PO y SO', ['PO 1', 'SO x', ''], f.seleccion);
f.elegir(2, '/A/Cat 1');
f.elegir(1, 'SO y');
Check('F4 cambiar SO limpia Categoria', ['PO 1', 'SO y', ''], f.seleccion);
f.elegir(2, '/A/Cat 2');
f.elegir(0, 'PO 3');
Check('F4 cambiar PO limpia SO y Categoria', ['PO 3', '', ''], f.seleccion);
Check('F4 PO 3: sus SO', ['SO z'], f.opciones(1));

f.elegir(0, '');
e = f.estado(true);
Check('F5 limpiar PO deja todo vacio', ['', '', ''], f.seleccion);
Check('F5 limpiar PO restaura todos los SO', ['SO w', 'SO x', 'SO y', 'SO z'], e[1].opciones);
Check('F5 limpiar PO restaura todas las categorias', TODAS_CAT, e[2].opciones);

f.elegir(0, 'PO 2');
Check('F6 SO fuera del PO no se acepta', false, f.elegir(1, 'SO z'));
Check('F6 categoria fuera del PO no se acepta', false, f.elegir(2, '/B/Cat 4'));
Check('F6 la seleccion sigue valida', { po: 'PO 2' }, f.filtros());

var sinPo = new Cascada(FILAS, 'filtro');
sinPo.elegir(1, 'SO x');
Check('F7 SO sin PO: categorias del SO en cualquier PO', ['/A/Cat 1', '/A/Cat 3'], sinPo.opciones(2));
Check('F7 elegir SO no cambia el PO vacio', ['', 'SO x', ''], sinPo.seleccion);

var huerf = new Cascada(FILAS, 'filtro');
huerf.seleccion = ['PO 9', '', ''];
e = huerf.estado(true);
Check('F8 PO sin filas: SO y Categoria bloqueados, sin categorias invalidas',
  [false, false, [], []], [e[1].habilitado, e[2].habilitado, e[1].opciones, e[2].opciones]);
Check('F8 motivo SO y Categoria', ['Sin valores para el Product Owner elegido.', 'Sin valores para el Product Owner elegido.'], [e[1].motivo, e[2].motivo]);
Check('F9 raiz bloqueada (catalogo cargando): todo bloqueado',
  [false, false, false], hab(new Cascada(FILAS, 'filtro').estado(false, 'Cargando…')));
Check('F9 catalogo vacio', 'Sin valores en el catálogo.', new Cascada([], 'filtro').estado(true)[1].motivo);

// ---------------------------------------------------------------------------
// M) una sola regla
// ---------------------------------------------------------------------------
var cr = new Cascada(FILAS, 'creacion'), fi = new Cascada(FILAS, 'filtro');
var iguales = true;
['PO 1', 'PO 2', 'PO 3'].forEach(function (po) {
  cr.elegir(0, po); fi.elegir(0, po);
  if (JSON.stringify(cr.opciones(1)) !== JSON.stringify(fi.opciones(1))) iguales = false;
  cr.opciones(1).forEach(function (so) {
    cr.elegir(1, so); fi.elegir(1, so);
    if (JSON.stringify(cr.opciones(2)) !== JSON.stringify(fi.opciones(2))) iguales = false;
  });
});
Check('M1 creacion y filtro dan las mismas opciones para la misma seleccion', true, iguales);

var js = leer('admin/iniciativas.js');
Check('M2 iniciativas.js no define otra cascada', false, /class\s+CascadaOrganizacional\b/.test(js));
Check('M2 iniciativas.js usa la compartida en modo creacion', true,
  /new CascadaOrganizacional\([^)]*'creacion'\)/.test(js));
var html = leer('admin/iniciativas.html');
Check('M3 la pagina carga la cascada antes que iniciativas.js', true,
  html.indexOf('cascada-organizacional.js') >= 0 &&
  html.indexOf('cascada-organizacional.js') < html.indexOf('src="iniciativas.js"'));

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
process.exit(fallos ? 1 : 0);
