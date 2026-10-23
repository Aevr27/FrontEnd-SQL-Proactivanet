// tools/tests/SeleccionKpiSmoke.js - prueba de humo de SeleccionKpi
// (assets/js/seleccion-kpi.js): el indicador elegido con un clic.
//
// NO forma parte del sitio: vive fuera de assets/.
//
// Partes:
//   E) Estado sin DOM: elegir, el mismo lo quita, otro lo reemplaza, la
//      clave que limpia (Total) lo quita, una que no existe no cambia nada,
//      limpiar, reconciliar tras una relectura (sigue / se quita),
//      copiarEn otra instancia.
//   A) atributos(): data-* y aria-pressed (sin aria-pressed en la que
//      limpia), atributo propio, escapado.
//   D) DOM: un escucha delegado por contenedor (sobrevive al innerHTML del
//      modulo), el clic en un hijo cuenta, un elemento sin el atributo no,
//      conectar dos veces no duplica; Enter / espacio llegan como clic del
//      <button>; enfocar() devuelve el foco al boton pulsado tras repintar.
//   C) clases() y boton(): la tarjeta y el boton que la cubre, con las
//      reglas de assets/css/kpi.css (y ya no en admin/iniciativas.css).
//   S) El script no guarda nada en el navegador ni pide datos.
//   L) Carga: una vez en dashboard.html (los modulos embebidos pierden sus
//      <script>), y en cada pagina suelta que lo usa, antes de su modulo.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\SeleccionKpiSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
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
(new Function('window', leer('assets/js/seleccion-kpi.js')))(ventana);
var SeleccionKpi = ventana.SeleccionKpi;

// ---- E) Estado sin DOM ----
var hoy = ['total', 'activas', 'cerradas', 'sem_x'];
function nueva(validas) {
  return new SeleccionKpi({ valida: function (k) { return validas.indexOf(k) >= 0; }, limpian: ['total'] });
}
var s = nueva(hoy);
Check('E1 nace sin nada elegido', '', s.clave);
Check('E1 elegir: cambia y queda elegida', [true, 'activas', true], [s.alternar('activas'), s.clave, s.es('activas')]);
Check('E2 el mismo otra vez la quita', [true, ''], [s.alternar('activas'), s.clave]);
s.alternar('activas');
Check('E3 otra la reemplaza (una a la vez)', [true, 'cerradas', false], [s.alternar('cerradas'), s.clave, s.es('activas')]);
Check('E4 la que limpia (Total) quita la elegida', [true, ''], [s.alternar('total'), s.clave]);
Check('E4 Total sin nada elegido: no cambia nada', [false, ''], [s.alternar('total'), s.clave]);
Check('E4 Total nunca queda elegida', false, s.es('total'));
s.alternar('cerradas');
Check('E5 una que no existe no cambia nada', [false, 'cerradas'], [s.alternar('inventada'), s.clave]);
Check('E5 vacia no cambia nada', [false, 'cerradas'], [s.alternar(''), s.clave]);
Check('E6 limpiar', [true, '', false], [s.limpiar(), s.clave, s.limpiar()]);

// Relectura: las claves validas cambian.
var validas = hoy.slice(), r = nueva(validas);
r.alternar('sem_x');
Check('E7 reconciliar: sigue valida, se conserva', [false, 'sem_x'], [r.reconciliar(), r.clave]);
validas.splice(validas.indexOf('sem_x'), 1);
Check('E7 reconciliar: ya no existe, se quita', [true, ''], [r.reconciliar(), r.clave]);
Check('E7 reconciliar sin nada elegido: nada', [false, ''], [r.reconciliar(), r.clave]);

// copiarEn: la eleccion pasa a otra instancia con SUS reglas.
var a = nueva(hoy); a.alternar('activas');
var b = a.copiarEn(nueva(hoy));
Check('E8 copiarEn: misma clave, otra instancia', ['activas', true], [b.clave, a !== b]);
var c = a.copiarEn(nueva(['total', 'cerradas']));
Check('E8 copiarEn a reglas donde ya no vale: se quita', '', c.clave);
b.alternar('cerradas');
Check('E8 las dos instancias no comparten estado', ['activas', 'cerradas'], [a.clave, b.clave]);
Check('E9 sin opciones: todo vale, nada limpia', ['x', ''], (function () {
  var z = new SeleccionKpi(); z.alternar('x'); var k = z.clave; z.alternar('x'); return [k, z.clave];
})());

// ---- A) atributos ----
var t = nueva(hoy); t.alternar('activas');
Check('A1 elegida: data-indicador + aria-pressed="true"', ' data-indicador="activas" aria-pressed="true"', t.atributos('activas'));
Check('A1 no elegida: aria-pressed="false"', ' data-indicador="cerradas" aria-pressed="false"', t.atributos('cerradas'));
Check('A2 la que limpia va sin aria-pressed (es una accion)', ' data-indicador="total"', t.atributos('total'));
var o = new SeleccionKpi({ atributo: 'data-kpi' });
Check('A3 atributo propio', ' data-kpi="a" aria-pressed="false"', o.atributos('a'));
Check('A3 escapado', ' data-kpi="a&quot;&lt;b" aria-pressed="false"', o.atributos('a"<b'));

// ---- C) clases y boton ----
var cb = nueva(hoy); cb.alternar('activas');
Check('C1 clases: elegida', ' kpi-filtrable kpi-sel', cb.clases('activas'));
Check('C1 clases: no elegida', ' kpi-filtrable', cb.clases('cerradas'));
Check('C1 clases: la que limpia nunca se marca', ' kpi-filtrable', cb.clases('total'));
Check('C2 boton: cubre la tarjeta, con atributos y nombre accesible',
  '<button type="button" class="kpi-filtro" data-indicador="activas" aria-pressed="true" aria-label="Activas: 12"></button>',
  cb.boton('activas', 'Activas: 12'));
Check('C2 boton: title opcional y escapado',
  '<button type="button" class="kpi-filtro" data-indicador="total" aria-label="A &quot;b&quot;" title="x&lt;y"></button>',
  cb.boton('total', 'A "b"', 'x<y'));
var kpiCss = leer('assets/css/kpi.css'), iniCss = leer('admin/iniciativas.css');
Check('C3 kpi.css: boton que cubre, foco visible, marca sin tocar la franja izquierda', [true, true, true, false],
  [/\.kpi-filtro \{[^}]*position: absolute; inset: 0; z-index: 1;/.test(kpiCss),
   /\.kpi-filtrable:has\(> \.kpi-filtro:focus-visible\) \{ outline: 2px solid/.test(kpiCss),
   /\.kpi\.kpi-sel \{[^}]*border-top-color/.test(kpiCss),
   /\.kpi\.kpi-sel \{[^}]*border-left/.test(kpiCss)]);
Check('C3 la marca tambien tiñe el rotulo de QA (.kpi-tit)', true, /\.kpi\.kpi-sel \.kpi-tit/.test(kpiCss));
Check('C4 admin/iniciativas.css ya no lleva copia', false, /kpi-filtr|kpi-sel/.test(iniCss.replace(/\/\*[\s\S]*?\*\//g, '')));

// ---- D) DOM ----
// Nodos minimos: padre, atributos, closest, querySelectorAll, foco y
// escuchas. innerHTML no se parsea: el modulo pinta, aqui se arman nodos.
function Nodo(atrs, padre) {
  var n = {
    atrs: atrs || {}, padre: padre || null, hijos: [], oyentes: {}, enfocado: 0,
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(this.atrs, k) ? this.atrs[k] : null; },
    closest: function (sel) {
      var k = sel.replace(/^\[|\]$/g, '');
      for (var x = this; x; x = x.padre) if (x.getAttribute(k) !== null) return x;
      return null;
    },
    querySelectorAll: function (sel) {
      var k = sel.replace(/^\[|\]$/g, ''), salida = [];
      (function rec(x) { x.hijos.forEach(function (h) { if (h.getAttribute(k) !== null) salida.push(h); rec(h); }); })(this);
      return salida;
    },
    focus: function () { this.enfocado++; documento.activo = this; },
    addEventListener: function (tipo, fn) { (this.oyentes[tipo] = this.oyentes[tipo] || []).push(fn); },
    // Burbujea desde el nodo hasta la raiz, como un clic real.
    clic: function () {
      var e = { target: this };
      for (var x = this; x; x = x.padre) (x.oyentes.click || []).forEach(function (fn) { fn(e); });
    }
  };
  if (padre) padre.hijos.push(n);
  return n;
}
var documento = { activo: null };
var tarjetas = Nodo({}), semaforo = Nodo({});
function pintar() {
  // El modulo repinta: nodos NUEVOS cada vez (como innerHTML).
  tarjetas.hijos = []; semaforo.hijos = [];
  ['total', 'activas', 'cerradas'].forEach(function (k) {
    var tarjeta = Nodo({ 'class': 'kpi' }, tarjetas);
    Nodo({ 'data-indicador': k }, tarjeta);
    Nodo({ 'class': 'ayuda' }, tarjeta);           // la franja Criterio: sin atributo
  });
  var b = Nodo({ 'data-indicador': 'sem_x' }, semaforo);
  Nodo({ 'class': 'punto' }, b);                     // hijo del boton
}
pintar();
var sel = nueva(hoy), pulsadas = [];
function alPulsar(k) {
  pulsadas.push(k);
  if (sel.alternar(k)) pintar();
  SeleccionKpi.enfocar([tarjetas, semaforo], 'data-indicador', k);
}
SeleccionKpi.escuchar([tarjetas, semaforo], 'data-indicador', alPulsar);
SeleccionKpi.escuchar([tarjetas, semaforo], 'data-indicador', alPulsar);   // dos veces: no duplica
function boton(caja, k) { return caja.querySelectorAll('[data-indicador]').filter(function (x) { return x.getAttribute('data-indicador') === k; })[0]; }

boton(tarjetas, 'activas').clic();
Check('D1 clic: un solo aviso aunque se conecto dos veces, queda elegida', [['activas'], 'activas'], [pulsadas, sel.clave]);
Check('D1 tras repintar, el foco vuelve al boton NUEVO pulsado', [true, 1], [documento.activo === boton(tarjetas, 'activas'), documento.activo.enfocado]);
boton(tarjetas, 'activas').clic();
Check('D2 clic en la elegida la quita; el foco sigue en ella', ['', true], [sel.clave, documento.activo === boton(tarjetas, 'activas')]);
boton(semaforo, 'sem_x').hijos[0].clic();
Check('D3 el clic en un hijo del boton cuenta (otro contenedor)', ['sem_x', true], [sel.clave, documento.activo === boton(semaforo, 'sem_x')]);
tarjetas.hijos[1].hijos[1].clic();
Check('D4 un elemento sin el atributo (franja de ayuda) no cuenta', [3, 'sem_x'], [pulsadas.length, sel.clave]);
boton(tarjetas, 'total').clic();
Check('D5 Total: quita la elegida y el foco queda en Total', ['', true], [sel.clave, documento.activo === boton(tarjetas, 'total')]);
// Teclado: Enter o espacio sobre un <button> el navegador los entrega como
// el mismo evento click (sin raton): misma ruta, mismo resultado.
var teclado = { target: boton(tarjetas, 'cerradas'), detail: 0 };
tarjetas.oyentes.click.forEach(function (fn) { fn(teclado); });
Check('D6 teclado (click con detail 0): elige y enfoca', ['cerradas', true], [sel.clave, documento.activo === boton(tarjetas, 'cerradas')]);
Check('D7 enfocar una clave que no esta: false, foco intacto', [false, true],
  [SeleccionKpi.enfocar([tarjetas], 'data-indicador', 'nada'), documento.activo === boton(tarjetas, 'cerradas')]);
Check('D8 claveDelEvento sin target ni closest: vacia', ['', ''],
  [SeleccionKpi.claveDelEvento({}, 'data-indicador'), SeleccionKpi.claveDelEvento({ target: { getAttribute: function () { return null; } } }, 'data-indicador')]);
Check('D9 escuchar ignora contenedores ausentes', true, (function () {
  try { SeleccionKpi.escuchar([null, {}], 'data-indicador', function () {}); return true; } catch (e) { return false; }
})());

// ---- S) Sin almacenamiento ni red ----
var src = leer('assets/js/seleccion-kpi.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
Check('S1 sin localStorage, sessionStorage, cookies ni fetch', false,
  /localStorage|sessionStorage|document\.cookie|fetch\(|XMLHttpRequest/.test(src));
Check('S2 un solo global: window.SeleccionKpi', ['SeleccionKpi'], Object.keys(ventana));

// ---- L) Carga ----
var SCRIPT = /<script src="(?:\.\.\/)?assets\/js\/seleccion-kpi\.js"><\/script>/g;
function veces(html) { return (html.match(SCRIPT) || []).length; }
var tablero = leer('dashboard.html');
Check('L1 dashboard.html lo carga una vez, antes de dashboard.js', [1, true],
  [veces(tablero), tablero.search(SCRIPT) < tablero.indexOf('<script src="dashboard.js">')]);
// Paginas sueltas: lo cargan una vez y antes de su modulo. Embebidas, el
// <script> se quita (moduloEmbebido) y usan la copia del tablero.
[['admin/iniciativas.html', 'registro-iniciativas.js'], ['orquestacion/orquestacion.html', 'orquestacion.js'],
 ['efectividad/efectividad.html', 'efectividad.js'], ['experiencia/experiencia.html', 'experiencia.js'],
 ['qa/qa.html', 'qa.js'], ['backlog/backlog.html', 'backlog.js']].forEach(function (x) {
  var html = leer(x[0]);
  Check('L2 ' + x[0] + ': una vez, antes de ' + x[1], [1, true],
    [veces(html), html.search(SCRIPT) >= 0 && html.search(SCRIPT) < html.indexOf('<script src="' + x[1] + '">')]);
});
// Cada modulo que lo usa lo toma de window y no se rompe si falta.
['orquestacion/orquestacion.js', 'efectividad/efectividad.js', 'experiencia/experiencia.js', 'qa/qa.js', 'backlog/backlog.js']
  .forEach(function (f) {
    var js = leer(f);
    Check('L3 ' + f + ': window.SeleccionKpi con guarda y un solo escucha', [true, 1],
      [/window\.SeleccionKpi\)?\s*\?/.test(js) || /var SK = window\.SeleccionKpi;[\s\S]*SK \? new SK/.test(js),
       (js.match(/\.escuchar\(/g) || []).length]);
  });

console.log(fallos ? '\n' + fallos + ' FALLARON' : '\nTODO PASO');
process.exit(fallos ? 1 : 0);
