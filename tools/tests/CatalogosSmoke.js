// tools/tests/CatalogosSmoke.js - prueba de humo de las <option> compartidas.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca.
//
// Fija tres cosas:
//
//   1) que assets/js/catalogos.js arma EXACTAMENTE el mismo marcado que las
//      plantillas que cada modulo tenia antes (dashboard.js, backlog.js y
//      experiencia.js). Las plantillas viejas estan copiadas aqui como
//      oraculo, con valores que ponen a prueba el escape;
//
//   2) que los tres modulos usan la copia compartida y no vuelven a su
//      plantilla propia;
//
//   3) que catalogos.js se carga despues de escape.js y antes del modulo en
//      dashboard.html y en las paginas sueltas.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\CatalogosSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8'); }

var ventana = {};
(new Function('window', leer(path.join('assets', 'js', 'escape.js'))))(ventana);
(new Function('window', 'Escape', leer(path.join('assets', 'js', 'catalogos.js'))))(ventana, ventana.Escape);
var Escape = ventana.Escape;
var Catalogos = ventana.Catalogos;

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

// Un <select> de mentira: solo lo que tocan las plantillas.
function Select(inicial) {
  return {
    innerHTML: inicial || '',
    insertAdjacentHTML: function (donde, html) {
      if (donde !== 'beforeend') throw new Error('posicion inesperada ' + donde);
      this.innerHTML += html;
    }
  };
}

var TODOS = '<option value="">— Todos —</option>';
var VALORES = [
  'Service Desk',
  'Lugo Solis, David',               // tecnico: lleva coma
  'Dirección de Tecnología',         // acentos y eñes no cambian
  'A & B <C> "D" \'E\'',             // los cinco caracteres del escape
  '<img src=x onerror=alert(1)>',
  '  espacios  ',
  '2026-09-24T00:00:00',             // fechas de corte de Backlog
  42                                 // un valor no texto
];

// --- 1. Mismo marcado que antes ------------------------------------------

// dashboard.js (ponerOpciones): sel.innerHTML = opcionesHtml(valores ?? [])
var viejoDashboard = function (v) {
  return v.map(function (x) {
    return '<option value="' + Escape.attr(x) + '">' + Escape.html(x) + '</option>';
  }).join('');
};
var sel = Select('<option value="viejo">viejo</option>');
Catalogos.llenar(sel, VALORES);
Check('dashboard: Grupos / Tecnicos', viejoDashboard(VALORES), sel.innerHTML);
sel = Select('<option value="viejo">viejo</option>');
Catalogos.llenar(sel, []);
Check('dashboard: catalogo vacio deja el select vacio', '', sel.innerHTML);

// backlog.js (cargarCatalogos -> llenar): mismo template
sel = Select();
Catalogos.llenar(sel, VALORES);
Check('backlog: C1 / Grupos / Lideres', viejoDashboard(VALORES), sel.innerHTML);

// experiencia.js: Director y Manager se AÑADEN al "— Todos —" del HTML
function viejoAnadir(sel, valores) {
  valores.forEach(function (d) {
    sel.insertAdjacentHTML('beforeend',
      '<option value="' + Escape.attr(d) + '">' + Escape.html(d) + '</option>');
  });
}
var a = Select(TODOS), b = Select(TODOS);
viejoAnadir(a, VALORES);
b.insertAdjacentHTML('beforeend', Catalogos.opciones(VALORES));
Check('experiencia: selDir / selMgr', a.innerHTML, b.innerHTML);

// experiencia.js: fillPO / fillSO reescriben con "— Todos —" delante
function viejoFill(sel, valores) {
  sel.innerHTML = TODOS;
  viejoAnadir(sel, valores);
}
[VALORES, [], ['Solo uno']].forEach(function (lista, i) {
  var x = Select('<option value="z">z</option>'), y = Select('<option value="z">z</option>');
  viejoFill(x, lista);
  Catalogos.llenar(y, lista, '— Todos —');
  Check('experiencia: fillPO / fillSO caso ' + i, x.innerHTML, y.innerHTML);
});

// El orden es el de entrada: el helper no ordena ni deduplica.
Check('orden de entrada', '<option value="b">b</option><option value="a">a</option><option value="b">b</option>',
  Catalogos.opciones(['b', 'a', 'b']));

// --- 2. Los modulos usan la copia compartida -------------------------------
var DASH = leer('dashboard.js');
var BACK = leer(path.join('backlog', 'backlog.js'));
var EXP  = leer(path.join('experiencia', 'experiencia.js'));

function aparece(titulo, texto, patron, esperado) {
  Check(titulo, String(esperado), String(texto.indexOf(patron) >= 0));
}
aparece('dashboard usa Catalogos.llenar', DASH, 'Catalogos.llenar(', true);
aparece('dashboard ya no tiene opcionesHtml', DASH, 'opcionesHtml', false);
aparece('backlog usa Catalogos.llenar', BACK, 'Catalogos.llenar(', true);
aparece('backlog ya no arma <option> a mano', BACK, '<option value="${escapeAttr(v)}">', false);
aparece('experiencia usa Catalogos.opciones', EXP, 'Catalogos.opciones(', true);
aparece('experiencia usa Catalogos.llenar', EXP, 'Catalogos.llenar(', true);
aparece('experiencia ya no arma <option> a mano', EXP, '`<option value="${Escape.attr(', false);
// Las dependencias siguen siendo de Experiencia.
aparece('experiencia conserva fillPO', EXP, 'function fillPO(){', true);
aparece('experiencia conserva fillSO', EXP, 'function fillSO(){', true);
aparece('experiencia: Director -> PO por jerarquia', EXP, 'P.jerarquia[fDir]', true);
aparece('experiencia: Manager -> SO por jerarquia_mgr', EXP, '(P.jerarquia_mgr||{})[fMgr]', true);

// --- 3. Orden de carga ------------------------------------------------------
[
  ['dashboard.html', 'assets/js/escape.js', 'assets/js/catalogos.js', 'dashboard.js'],
  [path.join('backlog', 'backlog.html'), '../assets/js/escape.js', '../assets/js/catalogos.js', 'backlog.js'],
  [path.join('experiencia', 'experiencia.html'), '../assets/js/escape.js', '../assets/js/catalogos.js', 'experiencia.js']
].forEach(function (caso) {
  var html = leer(caso[0]);
  var iEsc = html.indexOf('"' + caso[1] + '"');
  var iCat = html.indexOf('"' + caso[2] + '"');
  var iMod = html.indexOf('"' + caso[3] + '"');
  Check(caso[0] + ': escape.js < catalogos.js < ' + caso[3], 'true',
    String(iEsc >= 0 && iCat > iEsc && iMod > iCat));
});

console.log('');
if (fallos) {
  console.log(fallos + ' caso(s) FALLARON');
  process.exit(1);
}
console.log('TODO PASA');
