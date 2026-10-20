// tools/tests/NavegacionGruposSmoke.js - prueba de humo de los GRUPOS de la
// barra lateral (Observabilidad y Calidad de información).
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca.
//
// BarraLateralSmoke.js fija el marcado; esta prueba fija el COMPORTAMIENTO:
// se extrae del ARCHIVO REAL de dashboard.js el bloque del router -GRUPOS,
// listo/montando, resolverModulo(), activarTab() y los listeners de clic- y se
// corre contra un DOM de mentira armado con los botones, selectores y
// contenedores que trae dashboard.html. Los modulos son de mentira y cuentan
// cuantas veces se llama su init() (= montaje + peticiones) y su
// redimensionar().
//
// Lo que se comprueba:
//   - la entrada del grupo abre su primer modulo, y despues el ultimo visto;
//   - en la barra se marca el grupo y en el selector el modulo;
//   - solo se ve el selector del grupo activo, y ninguno fuera de un grupo
//     ni en un grupo de un solo modulo (Observabilidad, por ahora);
//   - ir y volver entre los dos modulos de un grupo, muchas veces, monta cada
//     uno UNA vez (init() = 1) y solo los remide al volver;
//   - un solo listener por boton, aunque se cambie de modulo muchas veces;
//   - los hashes de siempre (#qa, #qare, #tablero) siguen.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\NavegacionGruposSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var html = fs.readFileSync(path.join(raiz, 'dashboard.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
var js = fs.readFileSync(path.join(raiz, 'dashboard.js'), 'utf8').replace(/\r\n/g, '\n');

var fallos = 0;
function comprobar(titulo, obtenido, esperado) {
  var ok = String(obtenido) === String(esperado);
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + titulo +
    '  esperado=' + esperado + '  obtenido=' + obtenido);
}

function todas(texto, re) {
  var salida = [], m;
  re.lastIndex = 0;
  while ((m = re.exec(texto)) !== null) salida.push(m);
  return salida;
}

// --- DOM de mentira, con lo que trae dashboard.html -----------------------
function Nodo(clases, atributos) {
  var self = this;
  this.clases = {};
  clases.forEach(function (c) { self.clases[c] = true; });
  this.atributos = atributos;
  this.id = atributos.id || '';
  this.dataset = {};
  if (atributos['data-tab']) this.dataset.tab = atributos['data-tab'];
  if (atributos['data-grupo']) this.dataset.grupo = atributos['data-grupo'];
  this.hidden = 'hidden' in atributos;
  this.oyentes = [];
  this.classList = {
    toggle: function (c, si) { if (si) self.clases[c] = true; else delete self.clases[c]; },
    contains: function (c) { return !!self.clases[c]; },
  };
}
Nodo.prototype.setAttribute = function (n, v) { this.atributos[n] = String(v); };
Nodo.prototype.removeAttribute = function (n) { delete this.atributos[n]; };
Nodo.prototype.addEventListener = function (tipo, fn) { if (tipo === 'click') this.oyentes.push(fn); };
Nodo.prototype.click = function () { this.oyentes.forEach(function (fn) { fn(); }); };

function atributosDe(etiqueta) {
  var a = {};
  todas(etiqueta, /\s([a-z-]+)(?:="([^"]*)")?/g).forEach(function (m) { a[m[1]] = m[2] === undefined ? '' : m[2]; });
  return a;
}

var nodos = [];
todas(html, /<(button|a|nav|div)\s[^>]*class="([^"]*)"[^>]*>/g).forEach(function (m) {
  var clases = m[2].split(/\s+/);
  if (['mnav', 'subnav', 'subnav-btn', 'maintab-content'].some(function (c) { return clases.indexOf(c) !== -1; })) {
    nodos.push(new Nodo(clases, atributosDe(m[0].replace(/^<[a-z]+/, '').replace(/>$/, ''))));
  }
});

function casa(nodo, selector) {
  var m = selector.match(/^\.([a-z-]+)(\[data-tab\])?$/);
  if (!m) throw new Error('selector no previsto en la prueba: ' + selector);
  return nodo.classList.contains(m[1]) && (!m[2] || 'data-tab' in nodo.atributos);
}
var documentFalso = {
  querySelectorAll: function (selector) {
    return nodos.filter(function (n) { return casa(n, selector); });
  },
};
var hash = { valor: '' };
var historyFalso = { replaceState: function (a, b, url) { hash.valor = url; } };
var windowFalso = { matchMedia: function () { return { matches: false }; } };

// --- modulos de mentira, con contadores -----------------------------------
var bloqueModulos = js.match(/const MODULOS = \{([\s\S]*?)\n\};/);
if (!bloqueModulos) throw new Error('no encontre MODULOS en dashboard.js');
var claves = (bloqueModulos[1].match(/^\s{2}([a-z]+):/gm) || []).map(function (l) { return l.trim().slice(0, -1); });
var cuenta = {};
var MODULOS = {};
claves.forEach(function (n) {
  cuenta[n] = { init: 0, redimensionar: 0 };
  MODULOS[n] = {
    init: function () { cuenta[n].init++; },
    redimensionar: function () { cuenta[n].redimensionar++; },
  };
});

// --- el router, tal cual esta en dashboard.js -----------------------------
var inicio = js.indexOf('const GRUPOS = {');
var fin = js.indexOf('4bis. Barra lateral');
if (inicio < 0 || fin < 0) throw new Error('no encontre el bloque del router en dashboard.js');
var router = js.slice(inicio, js.lastIndexOf('/*', fin));
var api = new Function('MODULOS', 'document', 'history', 'location', 'window', 'plegarLateral', 'console',
  router + '\nreturn { activarTab: activarTab, listo: listo, ultimoDeGrupo: ultimoDeGrupo };')(
  MODULOS, documentFalso, historyFalso, { hash: '' }, windowFalso, function () {}, console);

// activarTab encadena promesas: hay que dejar que se asienten entre pasos.
function esperar() { return new Promise(function (r) { setTimeout(r, 0); }); }

function boton(selector, tab) {
  return documentFalso.querySelectorAll(selector).filter(function (b) { return b.dataset.tab === tab; })[0];
}
function activos(selector) {
  return documentFalso.querySelectorAll(selector)
    .filter(function (b) { return b.classList.contains('active'); })
    .map(function (b) { return b.dataset.tab || b.id; }).join(',');
}
function selectorVisible() {
  return documentFalso.querySelectorAll('.subnav')
    .filter(function (n) { return !n.hidden; })
    .map(function (n) { return n.dataset.grupo; }).join(',');
}
function contenedorActivo() { return activos('.maintab-content'); }

(async function () {
  // Un solo listener por boton, puesto al evaluar dashboard.js.
  documentFalso.querySelectorAll('.mnav[data-tab]').concat(documentFalso.querySelectorAll('.subnav-btn[data-tab]'))
    .forEach(function (b) { comprobar('un listener en "' + b.dataset.tab + '" (' + b.id + ')', b.oyentes.length, 1); });

  comprobar('nace oculto el selector', selectorVisible(), '');
  comprobar('solo Calidad lleva selector',
    documentFalso.querySelectorAll('.subnav').map(function (n) { return n.dataset.grupo; }).join(), 'calidad');

  // --- arranque en SLA: ningun selector ------------------------------------
  api.activarTab('sla'); await esperar();
  comprobar('SLA: sin selector de grupo', selectorVisible(), '');
  comprobar('SLA: barra marca sla', activos('.mnav'), 'sla');

  // --- Calidad de información ----------------------------------------------
  boton('.mnav', 'calidad').click(); await esperar();
  comprobar('Calidad: abre QA la primera vez', contenedorActivo(), 'tab-qa');
  comprobar('Calidad: barra marca el grupo', activos('.mnav'), 'calidad');
  comprobar('Calidad: aria-current en el grupo', boton('.mnav', 'calidad').atributos['aria-current'], 'page');
  comprobar('Calidad: solo su selector visible', selectorVisible(), 'calidad');
  comprobar('Calidad: selector marca QA', activos('.subnav-btn'), 'qa');
  comprobar('Calidad: hash del modulo', hash.valor, '#qa');

  boton('.subnav-btn', 'qare').click(); await esperar();
  comprobar('QARE: contenedor', contenedorActivo(), 'tab-qare');
  comprobar('QARE: barra sigue en el grupo', activos('.mnav'), 'calidad');
  comprobar('QARE: selector marca QARE', activos('.subnav-btn'), 'qare');
  comprobar('QARE: aria-current pasa a QARE',
    [boton('.subnav-btn', 'qare').atributos['aria-current'], boton('.subnav-btn', 'qa').atributos['aria-current']].join('|'), 'page|');
  comprobar('QARE: hash del modulo', hash.valor, '#qare');

  // Ir y volver muchas veces: cada modulo se monta una sola vez.
  for (var i = 0; i < 5; i++) {
    boton('.subnav-btn', 'qa').click(); await esperar();
    boton('.subnav-btn', 'qare').click(); await esperar();
  }
  comprobar('QA montado una sola vez', cuenta.qa.init, 1);
  comprobar('QARE montado una sola vez', cuenta.qare.init, 1);
  comprobar('QA solo se remide al volver', cuenta.qa.redimensionar, 5);
  comprobar('QARE solo se remide al volver', cuenta.qare.redimensionar, 5);

  // --- Observabilidad: un solo modulo, sin selector ------------------------
  boton('.mnav', 'observabilidad').click(); await esperar();
  comprobar('Observabilidad: abre el marco (tablero)', contenedorActivo(), 'tab-tablero');
  comprobar('Observabilidad: barra marca el grupo', activos('.mnav'), 'observabilidad');
  comprobar('Observabilidad: aria-current en el grupo', boton('.mnav', 'observabilidad').atributos['aria-current'], 'page');
  comprobar('Observabilidad: sin selector', selectorVisible(), '');
  comprobar('Observabilidad: hash del modulo', hash.valor, '#tablero');
  for (var j = 0; j < 3; j++) {
    boton('.mnav', 'calidad').click(); await esperar();
    boton('.mnav', 'observabilidad').click(); await esperar();
  }
  comprobar('el marco se monta una sola vez', cuenta.tablero.init, 1);

  // --- el grupo recuerda el ultimo modulo visto ----------------------------
  boton('.mnav', 'calidad').click(); await esperar();
  comprobar('volver a Calidad abre el ultimo visto (QARE)', contenedorActivo(), 'tab-qare');
  comprobar('volver al grupo no remonta', cuenta.qare.init + cuenta.qa.init, 2);

  // --- fuera de un grupo no queda selector ni grupo marcado ----------------
  boton('.mnav', 'backlog').click(); await esperar();
  comprobar('Backlog: sin selector', selectorVisible(), '');
  comprobar('Backlog: barra marca backlog', activos('.mnav'), 'backlog');

  // --- hashes de siempre y alias de grupo ----------------------------------
  api.activarTab('qa'); await esperar();
  comprobar('#qa abre QA con su grupo marcado', contenedorActivo() + '|' + activos('.mnav') + '|' + selectorVisible(), 'tab-qa|calidad|calidad');
  api.activarTab('tablero'); await esperar();
  comprobar('#tablero abre el marco con su grupo marcado', contenedorActivo() + '|' + activos('.mnav'), 'tab-tablero|observabilidad');
  api.activarTab('calidad'); await esperar();
  comprobar('#calidad abre el ultimo visto (QA, por el #qa de arriba)', contenedorActivo(), 'tab-qa');

  // --- ningun modulo montado dos veces en toda la prueba -------------------
  comprobar('ningun init() repetido', claves.filter(function (n) { return cuenta[n].init > 1; }).join(','), '');
  comprobar('solo se montaron los que se abrieron',
    claves.filter(function (n) { return cuenta[n].init === 1; }).sort().join(','),
    'backlog,qa,qare,sla,tablero');

  console.log('');
  if (fallos) {
    console.log(fallos + ' caso(s) FALLARON');
    process.exit(1);
  }
  console.log('TODO PASA');
})().catch(function (e) { console.error(e); process.exit(1); });
