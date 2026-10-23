// tools/tests/KpisFijosSmoke.js - prueba de humo del boton "Fijar KPIs".
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca.
//
// Partes:
//   A) KpisFijos.alternar (assets/js/kpis-fijos.js): pone y quita la clase
//      en la rejilla de SU boton, con aria-pressed; quitarla deja el nodo
//      igual que estaba; un id que no existe no cambia nada.
//   D) Un solo escucha delegado: cubre botones montados DESPUES (las
//      pestañas embebidas llegan sin sus scripts), el clic en un hijo del
//      boton cuenta, enganchar dos veces no duplica, cada pestaña su estado.
//   H) Marcado: cada pestaña con KPI (SLA, Call Center, Backlog,
//      Experiencia, QA, QARE, Analisis) tiene UN boton en su cabecera que
//      apunta a la rejilla .kpis de esa misma pestaña; dashboard.html y las
//      paginas sueltas cargan el script y la hoja.
//   C) Hoja: todo cuelga de .kpis.kpis-fijas (sin la clase no hay reglas),
//      sticky sin scroll vertical propio, tira horizontal en pantalla
//      estrecha/baja, por debajo de la barra lateral, y se suelta al imprimir.
//   S) El script no pide datos, no guarda estado ni toca filtros.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\KpisFijosSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r\n/g, '\n'); }

var fallos = 0;
function Check(nombre, esperado, obtenido) {
  var ok = JSON.stringify(esperado) === JSON.stringify(obtenido);
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + nombre + (ok ? '' : '  esperado=' + JSON.stringify(esperado) + '  obtenido=' + JSON.stringify(obtenido)));
}

// ---- DOM minimo ----
function Elemento(id, clases, padre) {
  var el = {
    id: id, padre: padre || null, atributos: {},
    clases: (clases || '').split(' ').filter(Boolean),
    classList: {
      contains: function (c) { return el.clases.indexOf(c) >= 0; },
      add: function (c) { if (!el.classList.contains(c)) el.clases.push(c); },
      remove: function (c) { el.clases = el.clases.filter(function (x) { return x !== c; }); }
    },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(el.atributos, k) ? el.atributos[k] : null; },
    setAttribute: function (k, v) { el.atributos[k] = String(v); },
    closest: function (sel) {
      var m = /^\[([a-z-]+)\]$/.exec(sel);
      for (var n = el; n; n = n.padre) if (m && n.getAttribute(m[1]) !== null) return n;
      return null;
    }
  };
  return el;
}
function Documento() {
  var ids = {}, escuchas = [];
  return {
    ids: ids, escuchas: escuchas,
    getElementById: function (id) { return ids[id] || null; },
    addEventListener: function (tipo, fn) { escuchas.push({ tipo: tipo, fn: fn }); },
    clic: function (target) { escuchas.filter(function (e) { return e.tipo === 'click'; }).forEach(function (e) { e.fn({ target: target }); }); }
  };
}
function Boton(destino, padre) {
  var b = Elemento('', 'btn linea chico kpis-fijar', padre);
  b.setAttribute('data-kpis-fijar', destino);
  b.setAttribute('aria-pressed', 'false');
  return b;
}

var fuente = leer('assets/js/kpis-fijos.js');
function cargar(doc) {
  var ventana = { document: doc };
  (new Function('window', fuente))(ventana);
  return ventana.KpisFijos;
}

// ---- A) alternar ----
var doc = Documento();
var K = cargar(doc);
var kpis = Elemento('kpis', 'kpis'); doc.ids.kpis = kpis;
var b1 = Boton('kpis');
Check('A1 fija: clase y aria-pressed', [true, ['kpis', 'kpis-fijas'], 'true'], [K.alternar(b1, doc), kpis.clases, b1.getAttribute('aria-pressed')]);
Check('A2 suelta: la rejilla vuelve EXACTAMENTE a sus clases', [false, ['kpis'], 'false'], [K.alternar(b1, doc), kpis.clases, b1.getAttribute('aria-pressed')]);
var b0 = Boton('no-existe');
Check('A3 rejilla inexistente: null y nada cambia', [null, 'false', ['kpis']], [K.alternar(b0, doc), b0.getAttribute('aria-pressed'), kpis.clases]);
Check('A4 la clase es kpis-fijas', 'kpis-fijas', K.CLASE);

// ---- D) delegacion ----
Check('D1 al cargar se engancha UN escucha de clic', 1, doc.escuchas.length);
K.enganchar(doc);
Check('D2 enganchar otra vez no duplica', 1, doc.escuchas.length);
// Pestaña montada despues (Backlog embebido): su boton llega sin script.
var kpisBl = Elemento('kpis-bl', 'kpis'); doc.ids['kpis-bl'] = kpisBl;
var bBl = Boton('kpis-bl');
var texto = Elemento('', '', bBl);   // clic sobre un hijo del boton
doc.clic(texto);
Check('D3 boton montado despues: el clic (en un hijo) lo fija', [['kpis', 'kpis-fijas'], 'true'], [kpisBl.clases, bBl.getAttribute('aria-pressed')]);
Check('D4 cada pestaña su estado: la de SLA no se movio', ['kpis'], kpis.clases);
doc.clic(Elemento('', 'otra-cosa'));
Check('D5 un clic fuera de un boton no cambia nada', [['kpis', 'kpis-fijas'], ['kpis']], [kpisBl.clases, kpis.clases]);
doc.clic(bBl);
Check('D6 segundo clic la suelta', [['kpis'], 'false'], [kpisBl.clases, bBl.getAttribute('aria-pressed')]);

// ---- H) marcado ----
var PESTANAS = [
  { pagina: 'dashboard.html', tab: 'tab-sla', rejilla: 'kpis' },
  { pagina: 'dashboard.html', tab: 'tab-call', rejilla: 'kpis-llamadas' },
  { pagina: 'backlog/backlog.html', tab: 'tab-backlog', rejilla: 'kpis-bl' },
  { pagina: 'experiencia/experiencia.html', tab: 'tab-experiencia', rejilla: 'kpis-exp' },
  { pagina: 'qa/qa.html', tab: 'tab-qa', rejilla: 'qa-kpis' },
  { pagina: 'qare/qare.html', tab: 'tab-qare', rejilla: 'qare-kpis' },
  { pagina: 'analisis/analisis.html', tab: 'tab-analisis', rejilla: 'an-kpis' },
  { pagina: 'orquestacion/orquestacion.html', tab: 'tab-orquestacion', rejilla: 'orq-kpis' },
  { pagina: 'efectividad/efectividad.html', tab: 'tab-efectividad', rejilla: 'ef-kpis' }
];
function bloqueDeTab(html, tab) {
  var ini = html.indexOf('id="' + tab + '"');
  if (ini < 0) return '';
  var sig = html.slice(ini + 1).search(/<div id="tab-[a-z]+" class="maintab-content/);
  return sig < 0 ? html.slice(ini) : html.slice(ini, ini + 1 + sig);
}
PESTANAS.forEach(function (p) {
  var html = leer(p.pagina).replace(/<!--[\s\S]*?-->/g, '');
  var bloque = bloqueDeTab(html, p.tab);
  var botones = bloque.match(/data-kpis-fijar="[^"]*"/g) || [];
  var cab = (/<header class="top">[\s\S]*?<\/header>/.exec(bloque) || [''])[0];
  Check('H1 ' + p.tab + ': un boton, en la cabecera, hacia su propia rejilla .kpis', [['data-kpis-fijar="' + p.rejilla + '"'], true, true, true], [
    botones,
    /<div class="acciones-top">[\s\S]*data-kpis-fijar=/.test(cab),
    new RegExp('<section class="kpis" id="' + p.rejilla + '">').test(bloque),
    /<button type="button" class="btn linea chico kpis-fijar" data-kpis-fijar="[^"]+" aria-pressed="false" title="[^"]+">Fijar KPIs<\/button>/.test(cab)
  ]);
});
var dash = leer('dashboard.html');
Check('H2 dashboard.html carga la hoja y el script una vez', [1, 1], [
  (dash.match(/<link rel="stylesheet" href="assets\/css\/kpis-fijos\.css">/g) || []).length,
  (dash.match(/<script src="assets\/js\/kpis-fijos\.js"><\/script>/g) || []).length]);
['backlog/backlog.html', 'experiencia/experiencia.html', 'qa/qa.html', 'qare/qare.html', 'analisis/analisis.html',
 'orquestacion/orquestacion.html', 'efectividad/efectividad.html'].forEach(function (p) {
  var h = leer(p);
  Check('H3 ' + p + ' suelta: carga hoja y script', true,
    /href="\.\.\/assets\/css\/kpis-fijos\.css"/.test(h) && /src="\.\.\/assets\/js\/kpis-fijos\.js"/.test(h));
});
// Embebidas: moduloEmbebido quita <script> y <link> del modulo, asi que el
// unico escucha es el del anfitrion (por eso la delegacion).
Check('H4 moduloEmbebido quita script y link del modulo', true,
  /doc\.querySelectorAll\('script, link\[rel="stylesheet"\]'\)\.forEach\(n => n\.remove\(\)\);/.test(leer('dashboard.js')));
Check('H5 el Tablero (iframe legacy) no lleva boton', '', (bloqueDeTab(dash, 'tab-tablero').match(/data-kpis-fijar/g) || []).join(''));

// ---- C) hoja ----
var css = leer('assets/css/kpis-fijos.css').replace(/\/\*[\s\S]*?\*\//g, '');
var selectores = (css.match(/[^{}@]+(?=\{)/g) || []).map(function (s) { return s.trim(); })
  .filter(function (s) { return s && !/^media/.test(s); });
Check('C1 toda regla de la rejilla exige .kpis-fijas (sin la clase, nada cambia)', [],
  selectores.filter(function (s) { return /\.kpis(?![\w-])/.test(s) && !/\.kpis\.kpis-fijas/.test(s); }));
var base = (/\.kpis\.kpis-fijas \{([^}]*)\}/.exec(css) || ['', ''])[1];
Check('C2 sticky arriba, sin scroll vertical propio', [true, true, false], [
  /position: sticky; top: 0;/.test(base), /z-index: 20;/.test(base), /overflow/.test(base)]);
Check('C3 padding compensado con margin negativo (no salta al activarse)', true,
  /padding-top: 8px; margin-top: -8px;/.test(base) && /margin-bottom: calc\(var\(--gap-bloque, 16px\) - 8px\)/.test(base));
Check('C4 z-index por debajo de la barra lateral (50)', true, 20 < 50);
var estrecha = (/@media \(max-width: 900px\), \(max-height: 720px\) \{([\s\S]*?)\n\}/.exec(css) || ['', ''])[1];
Check('C5 estrecha/baja: una fila con scroll SOLO horizontal', true,
  /grid-auto-flow: column;/.test(estrecha) && /overflow-x: auto; overflow-y: hidden;/.test(estrecha));
Check('C6 rejilla vacia (Analisis antes del primer resultado): sin franja', true, /\.kpis\.kpis-fijas:empty \{ padding: 0; margin-top: 0;/.test(css));
Check('C7 al imprimir se suelta y el boton no sale', true,
  /@media print \{[\s\S]*\.kpis\.kpis-fijas \{ position: static;[\s\S]*\.kpis-fijar \{ display: none !important; \}/.test(css));

// ---- S) sin efectos ----
var codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
Check('S1 sin fetch, XHR, storage ni timers', false, /fetch\(|XMLHttpRequest|localStorage|sessionStorage|setTimeout|setInterval/.test(codigo));
Check('S2 solo toca la clase y aria-pressed', true, /classList\.add\(CLASE\)/.test(codigo) && /setAttribute\('aria-pressed'/.test(codigo) && !/innerHTML|cloneNode|appendChild/.test(codigo));

console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
process.exit(fallos ? 1 : 0);
