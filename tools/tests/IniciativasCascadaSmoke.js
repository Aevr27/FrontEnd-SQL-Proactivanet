// tools/tests/IniciativasCascadaSmoke.js - prueba de humo de "Nueva
// solicitud" en admin/iniciativas.html:
//
//   Tipo de iniciativa -> Product Owner -> Service Owner -> Categoria
//                                                        -> Director (derivado)
//
// NO forma parte del sitio: vive fuera de admin/, asi que ni IIS ni el
// navegador la cargan nunca.
//
// Partes:
//   A) CascadaOrganizacional: opciones por nivel, reseteo de los hijos,
//      valores fuera de catalogo, motivos, hijo sin valores, Director.
//   T) SolicitudNueva: tipo (carga, invalido, habilita, resetea), campos del
//      tipo (definidos por datos) y campos comunes.
//   G) GloboAyuda: el patron "Pregunta" de QARE con eventos de mentira.
//   B) PaginaIniciativas sobre un DOM de mentira con un `pedir` propio:
//      cascada con eventos change, Director derivado, campos, ayuda del
//      Titulo, carga, error 500, red, no JSON, 404, catalogo vacio, sin
//      tipos, omitidas, reintento y carga vieja que llega tarde.
//   V) Vistas: Iniciativas de inicio, el boton abre Nueva solicitud, y el
//      borrador sobrevive Iniciativas -> Nueva -> Iniciativas -> Nueva.
//   P) Nada se persiste: una sola peticion (GET del catalogo) y ningun
//      envio en el codigo.
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
// DOM de mentira: solo lo que tocan globo-ayuda.js e iniciativas.js
// ---------------------------------------------------------------------------
function Elemento(id) {
  var oyentes = {};
  var clases = {};
  var atributos = {};
  return {
    id: id, textContent: '', hidden: false, innerHTML: '', value: '', disabled: false,
    className: '', style: {}, offsetWidth: 200, hijos: [],
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
    getBoundingClientRect: function () { return { left: 100, width: 80, bottom: 50 }; },
    addEventListener: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    disparar: function (tipo, evento) {
      var self = this;
      var e = evento || { target: self };
      (oyentes[tipo] || []).forEach(function (fn) { fn(e); });
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
  var doc = Elemento('document');
  doc.readyState = 'complete';
  doc.getElementById = function (id) { return els[id] || (els[id] = Elemento(id)); };
  doc.querySelectorAll = function () { return []; };
  doc.createElement = function () { return Elemento(''); };
  doc.body = Elemento('body');
  doc.documentElement = { clientWidth: 1200 };
  return doc;
}

// Carga los scripts en una "ventana" nueva con su documento y su fetch.
function Pagina(pedir, antes) {
  var ventana = Elemento('window');
  var documento = Documento();
  (new Function('window', leer('assets/js/escape.js')))(ventana);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(ventana, ventana.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(ventana, documento);
  (new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.GloboAyuda, pedir);
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
var TIPOS = ['Adopcion', 'Mejora', 'Problem'];
var JSON_OK = { tipos: TIPOS, asignaciones: FILAS, omitidas: 0 };
function pedirOk() { return Promise.resolve(Respuesta(200, JSON_OK)); }
function nunca() { return new Promise(function () {}); }

var base = Pagina(nunca);
var I = base.ventana.Iniciativas;

// ---------------------------------------------------------------------------
// A) CascadaOrganizacional
// ---------------------------------------------------------------------------
var c = new I.CascadaOrganizacional(FILAS);
var e = c.estado(true, 'x');
Check('A1 inicial: solo PO habilitado', [true, false, false], e.map(function (x) { return x.habilitado; }));
Check('A1 inicial: todos los POs (sin filtrar por Director)', ['PO 1', 'PO 2', 'PO 3'], e[0].opciones);
Check('A1 inicial: motivo SO', 'Elige primero un Product Owner.', e[1].motivo);
Check('A1 inicial: motivo Categoria', 'Elige primero un Service Owner.', e[2].motivo);
Check('A1 raiz bloqueada: motivo del tipo', 'Elige primero un Tipo de iniciativa.',
  c.estado(false, 'Elige primero un Tipo de iniciativa.')[0].motivo);

c.elegir(0, 'PO 1');
Check('A2 PO 1: SOs de todas sus filas', ['SO w', 'SO x', 'SO y'], c.estado(true)[1].opciones);
c.elegir(1, 'SO x');
Check('A2 PO 1/SO x: categorias', ['/A/Cat 1'], c.estado(true)[2].opciones);
Check('A2 sin categoria: sin Director', '', c.director());
c.elegir(2, '/A/Cat 1');
Check('A2 seleccion completa', ['PO 1', 'SO x', '/A/Cat 1'], c.seleccion);
Check('A2 todo habilitado', [true, true, true], c.estado(true).map(function (x) { return x.habilitado; }));
Check('A2 Director derivado de la categoria', 'Dir A', c.director());

c.elegir(0, 'PO 3');
Check('A3 cambiar PO limpia SO y Categoria', ['PO 3', '', ''], c.seleccion);
Check('A3 cambiar PO limpia Director', '', c.director());
Check('A3 hijos bloqueados otra vez', [true, true, false], c.estado(true).map(function (x) { return x.habilitado; }));
c.elegir(1, 'SO z'); c.elegir(2, '/B/Cat 5');
Check('A3 PO 3/SO z/Cat 5: Dir B', 'Dir B', c.director());
c.elegir(1, 'SO z');
Check('A3 cambiar SO limpia Categoria', ['PO 3', 'SO z', ''], c.seleccion);
Check('A3 cambiar SO limpia Director', '', c.director());
c.elegir(2, '/B/Cat 4');
c.elegir(2, '/B/Cat 5');
Check('A3 cambiar Categoria recalcula Director', 'Dir B', c.director());
c.elegir(0, 'PO 1'); c.elegir(1, 'SO w');
Check('A3 PO 1 + SO w: solo Cat 6', ['/B/Cat 6'], c.estado(true)[2].opciones);
c.elegir(2, '/B/Cat 6');
Check('A3 PO 1 con dos directores: el de SU categoria', 'Dir B', c.director());
c.elegir(0, '');
Check('A3 volver a "— Elige —" limpia hacia abajo', ['', '', ''], c.seleccion);

c.elegir(0, 'PO 2');
Check('A4 valor fuera de catalogo no se acepta', false, c.elegir(1, 'SO z'));
Check('A4 y deja el nivel vacio', ['PO 2', '', ''], c.seleccion);

var h = new I.CascadaOrganizacional(FILAS);
h.seleccion = ['PO 9', '', ''];
var huerfano = h.estado(true);
Check('A5 hijo sin valores: bloqueado', false, huerfano[1].habilitado);
Check('A5 hijo sin valores: motivo', 'Sin valores para el Product Owner elegido.', huerfano[1].motivo);
Check('A5 catalogo vacio: PO bloqueado', 'Sin valores en el catálogo.', new I.CascadaOrganizacional([]).estado(true)[0].motivo);

var amb = new I.CascadaOrganizacional([
  { director: 'D1', po: 'P', so: 'S', categoria: 'C' },
  { director: 'D2', po: 'P', so: 'S', categoria: 'C' }
]);
amb.elegir(0, 'P'); amb.elegir(1, 'S'); amb.elegir(2, 'C');
Check('A6 dos Directores para la misma categoria: no se adivina', '', amb.director());

// CatalogoIniciativas
var cat = I.CatalogoIniciativas.desdeJson({ tipos: ['Mejora', '', 3, 'Mejora', 'Problem'], asignaciones: [
  FILAS[0], { director: 'X', po: 'Y', so: '', categoria: 'Z' }, { director: 'X', po: 1, so: 'S', categoria: 'Z' }, null
], omitidas: '2' });
Check('A7 desdeJson descarta filas incompletas', 1, cat.asignaciones.length);
Check('A7 desdeJson descarta tipos vacios, no texto y repetidos', ['Mejora', 'Problem'], cat.tipos);
Check('A7 desdeJson omitidas', 2, cat.omitidas);
var lanzo = 0;
try { I.CatalogoIniciativas.desdeJson({ error: 'x' }); } catch (err) { lanzo++; }
try { I.CatalogoIniciativas.desdeJson({ asignaciones: [] }); } catch (err) { lanzo++; }
Check('A7 sin asignaciones o sin tipos lanza', 2, lanzo);

// ---------------------------------------------------------------------------
// T) SolicitudNueva
// ---------------------------------------------------------------------------
var DEFS = {
  'Mejora': { campos: [
    { clave: 'beneficio', etiqueta: 'Beneficio', control: 'texto' },
    { clave: 'alcance', etiqueta: 'Alcance', control: 'multilinea', reiniciaConCascada: true }
  ] }
};
var catOk = I.CatalogoIniciativas.desdeJson(JSON_OK);
var s = new I.SolicitudNueva(catOk, DEFS);
var est = s.estado();
Check('T1 tipos cargados', TIPOS, est.tipo.opciones);
Check('T1 tipo habilitado', true, est.tipo.habilitado);
Check('T3 sin tipo: PO bloqueado', false, est.niveles[0].habilitado);
Check('T3 sin tipo: motivo', 'Elige primero un Tipo de iniciativa.', est.niveles[0].motivo);
Check('T3 sin tipo: campos ocultos', false, est.camposVisibles);
Check('T3 sin tipo: la cascada no acepta valores', false, s.elegir(0, 'PO 1'));

Check('T2 tipo invalido rechazado', false, s.elegirTipo('Inventado'));
Check('T2 y queda sin tipo', '', s.tipo);
Check('T3 tipo valido aceptado', true, s.elegirTipo('Mejora'));
est = s.estado();
Check('T3 tipo habilita PO', true, est.niveles[0].habilitado);
Check('T3 tipo muestra campos', true, est.camposVisibles);
Check('T3 tipo no filtra los POs', ['PO 1', 'PO 2', 'PO 3'], est.niveles[0].opciones);

s.elegir(0, 'PO 1'); s.elegir(1, 'SO y'); s.elegir(2, '/A/Cat 2');
est = s.estado();
Check('T5 cascada completa', ['PO 1', 'SO y', '/A/Cat 2'], est.niveles.map(function (x) { return x.valor; }));
Check('T8 Director derivado', 'Dir A', est.director.valor);
Check('T8 motivo del derivado', 'Derivado de la categoría.', est.director.motivo);

s.capturar('titulo', 'Mi titulo');
s.capturar('analisis', 'Mi analisis');
s.capturar('beneficio', 'Ahorro');
s.capturar('alcance', 'Todo /A');
s.capturar('inventado', 'x');
Check('T11/12 comunes capturados', { titulo: 'Mi titulo', analisis: 'Mi analisis' }, s.valores);
Check('T10 campos del tipo capturados', { beneficio: 'Ahorro', alcance: 'Todo /A' }, s.valoresTipo);

s.elegir(1, 'SO x');
Check('T7 cambiar SO limpia Categoria y Director', ['PO 1', 'SO x', '', ''],
  s.cascada.seleccion.concat([s.cascada.director()]));
Check('T10 cambio en cascada limpia el campo que depende de ella', { beneficio: 'Ahorro' }, s.valoresTipo);
s.capturar('alcance', 'otra vez');
s.elegir(0, 'PO 2');
Check('T6 cambiar PO limpia SO/Categoria/Director', ['PO 2', '', '', ''],
  s.cascada.seleccion.concat([s.cascada.director()]));

s.elegir(1, 'SO x'); s.elegir(2, '/A/Cat 3');
s.elegirTipo('Problem');
Check('T4 cambiar tipo limpia PO/SO/Categoria/Director', ['', '', '', ''],
  s.cascada.seleccion.concat([s.cascada.director()]));
Check('T10 cambiar tipo limpia los campos del tipo', {}, s.valoresTipo);
Check('T10 el tipo nuevo no tiene campos propios', [], s.camposTipo());
Check('T11/12 cambiar tipo conserva Titulo y Analisis', { titulo: 'Mi titulo', analisis: 'Mi analisis' }, s.valores);
s.elegirTipo('');
Check('T4 volver a sin tipo bloquea la cascada', false, s.estado().niveles[0].habilitado);

var sinTipos = new I.SolicitudNueva(I.CatalogoIniciativas.desdeJson({ tipos: [], asignaciones: FILAS }), DEFS);
Check('T1 sin tipos: select bloqueado', [false, 'Sin tipos de iniciativa en el catálogo.'],
  [sinTipos.estado().tipo.habilitado, sinTipos.estado().tipo.motivo]);

Check('T11 campo comun Titulo', ['titulo', 'Título', 'texto'],
  [I.CAMPOS_COMUNES[0].clave, I.CAMPOS_COMUNES[0].etiqueta, I.CAMPOS_COMUNES[0].control]);
Check('T12 campo comun Analisis multilinea', ['analisis', 'multilinea'],
  [I.CAMPOS_COMUNES[1].clave, I.CAMPOS_COMUNES[1].control]);
Check('T10 DEFINICIONES_TIPO vacio: ningun campo de tipo inventado', [], Object.keys(I.DEFINICIONES_TIPO));

// ---------------------------------------------------------------------------
// G) GloboAyuda (patron "Pregunta" de QARE)
// ---------------------------------------------------------------------------
(function () {
  var doc = Documento();
  var v = Elemento('window');
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(v, doc);
  var raizG = Elemento('raiz');
  var destino = Elemento('rotulo');
  destino.closest = function () { return destino; };
  var fuera = Elemento('fuera');
  fuera.closest = function () { return null; };
  var g = new v.GloboAyuda(raizG, '.ayuda-destino', function () { return { texto: 'Ayuda', nota: null }; }).conectar();
  Check('G0 globo con role=tooltip, oculto, en el body', ['tooltip', true, 1],
    [g.globo.getAttribute('role'), g.globo.hidden, doc.body.hijos.length]);
  raizG.disparar('pointerover', { target: destino, pointerType: 'mouse' });
  Check('G1 mouse entra: se muestra con el texto', [false, 'Ayuda', true],
    [g.globo.hidden, g.texto.textContent, destino.classList.contains('abierto')]);
  Check('G1 sin nota: nota oculta', true, g.nota.hidden);
  Check('G1 posicion: centrado bajo el destino (100 + 80/2 - 200/2)', ['40px', '56px'], [g.globo.style.left, g.globo.style.top]);
  raizG.disparar('pointerout', { target: destino, pointerType: 'mouse', relatedTarget: fuera });
  Check('G2 mouse sale: se oculta', [true, false], [g.globo.hidden, destino.classList.contains('abierto')]);
  raizG.disparar('click', { target: destino, pointerType: 'touch' });
  Check('G3 toque: abre', false, g.globo.hidden);
  raizG.disparar('click', { target: destino, pointerType: 'touch' });
  Check('G3 segundo toque: cierra', true, g.globo.hidden);
  raizG.disparar('pointerover', { target: destino, pointerType: 'mouse' });
  doc.disparar('keydown', { key: 'Escape' });
  Check('G4 Escape cierra', true, g.globo.hidden);
  raizG.disparar('pointerover', { target: destino, pointerType: 'mouse' });
  doc.disparar('click', { target: fuera });
  Check('G5 clic fuera cierra', true, g.globo.hidden);
  raizG.disparar('pointerover', { target: destino, pointerType: 'touch' });
  Check('G6 pointerover de toque no abre (lo hace el click)', true, g.globo.hidden);
})();

// ---------------------------------------------------------------------------
// B) Pagina
// ---------------------------------------------------------------------------
var IDS = ['selPo', 'selSo', 'selCategoria'];
function habilitados(p) { return ['selTipo'].concat(IDS).map(function (id) { return !p.sel(id).disabled; }); }
function valores(p) { return ['selTipo'].concat(IDS).map(function (id) { return p.sel(id).value; }); }
function elegirEn(p, id, v) { p.sel(id).value = v; p.sel(id).disparar('change'); }
function escribir(p, contenedor, clave, texto) {
  var t = Elemento('campo-' + clave);
  t.setAttribute('data-campo', clave);
  t.value = texto;
  p.sel(contenedor).disparar('input', { target: t });
}

var pruebas = [];

// B1 carga correcta + cascada con eventos change
pruebas.push(function () {
  var urls = [];
  var p = Pagina(function (url) { urls.push(url); return pedirOk(); });
  var P = p.ventana.IniciativasPagina;
  return P.cargar(function (url) { urls.push(url); return pedirOk(); }).then(function () {
    Check('B1 URL del handler', '../handlers/admin_iniciativas_catalogos.ashx', urls[urls.length - 1]);
    Check('B1 cargado: solo Tipo habilitado', [true, false, false, false], habilitados(p));
    Check('B1 tipos en el select', TIPOS, p.sel('selTipo').opciones());
    Check('B1 motivo PO', 'Elige primero un Tipo de iniciativa.', p.sel('motPo').textContent);
    Check('B1 Director vacio', ['—', 'Se completa al elegir la Categoría.'],
      [p.sel('outDirector').textContent, p.sel('motDirector').textContent]);
    Check('B1 campos ocultos sin tipo', true, p.sel('iniBloqueCampos').hidden);
    Check('B1 sin error ni omitidas', [true, true], [p.sel('iniError').hidden, p.sel('iniOmitidas').hidden]);

    elegirEn(p, 'selTipo', 'Inventado');
    Check('B2 tipo invalido: rechazado, cascada bloqueada', ['', false], [p.sel('selTipo').value, !p.sel('selPo').disabled]);

    elegirEn(p, 'selTipo', 'Mejora');
    Check('B3 tipo habilita PO', [true, true, false, false], habilitados(p));
    Check('B3 tipo muestra campos', false, p.sel('iniBloqueCampos').hidden);

    elegirEn(p, 'selPo', 'PO 1');
    elegirEn(p, 'selSo', 'SO y');
    elegirEn(p, 'selCategoria', '/A/Cat 2');
    Check('B5 cadena completa', ['Mejora', 'PO 1', 'SO y', '/A/Cat 2'], valores(p));
    Check('B8 Director derivado', 'Dir A', p.sel('outDirector').textContent);
    Check('B9 Director es texto, no select', ['', 'Derivado de la categoría.'],
      [p.sel('outDirector').innerHTML, p.sel('motDirector').textContent]);

    elegirEn(p, 'selSo', 'SO x');
    Check('B7 cambiar SO limpia Categoria', ['Mejora', 'PO 1', 'SO x', ''], valores(p));
    Check('B7 cambiar SO limpia Director', '—', p.sel('outDirector').textContent);
    elegirEn(p, 'selCategoria', '/A/Cat 1');
    Check('B8 otra categoria recalcula Director', 'Dir A', p.sel('outDirector').textContent);

    elegirEn(p, 'selPo', 'PO 3');
    Check('B6 cambiar PO limpia SO/Categoria', ['Mejora', 'PO 3', '', ''], valores(p));
    Check('B6 cambiar PO limpia Director', '—', p.sel('outDirector').textContent);
    Check('B6 SO habilitado, Categoria bloqueada', [true, true, true, false], habilitados(p));
    Check('B6 SO sin opciones viejas', ['SO z'], p.sel('selSo').opciones());
    Check('B6 motivo Categoria', 'Elige primero un Service Owner.', p.sel('motCategoria').textContent);

    elegirEn(p, 'selSo', 'SO z'); elegirEn(p, 'selCategoria', '/B/Cat 4');
    Check('B8 Director de Dir B', 'Dir B', p.sel('outDirector').textContent);
    elegirEn(p, 'selTipo', 'Problem');
    Check('B4 cambiar tipo limpia PO/SO/Categoria', ['Problem', '', '', ''], valores(p));
    Check('B4 cambiar tipo limpia Director', '—', p.sel('outDirector').textContent);
    Check('B4 cambiar tipo deja PO habilitado y el resto bloqueado', [true, true, false, false], habilitados(p));

    elegirEn(p, 'selTipo', '');
    Check('B4 sin tipo: cascada bloqueada y campos ocultos', [[true, false, false, false], true],
      [habilitados(p), p.sel('iniBloqueCampos').hidden]);
  });
});

// B10-13 campos: comunes, del tipo y ayuda del Titulo
pruebas.push(function () {
  var p = Pagina(nunca);
  var I2 = p.ventana.Iniciativas;
  I2.DEFINICIONES_TIPO['Mejora'] = DEFS['Mejora'];
  var P = p.ventana.IniciativasPagina;
  return P.cargar(pedirOk).then(function () {
    var comunes = p.sel('iniCamposComunes').innerHTML;
    Check('B11 Titulo: input de texto', true, comunes.indexOf('<input type="text" id="campo-titulo" data-campo="titulo"') >= 0);
    Check('B12 Analisis: textarea', true, comunes.indexOf('<textarea id="campo-analisis" data-campo="analisis" rows="6">') >= 0);
    Check('B13 rotulo Titulo es el destino de la ayuda (clase de GloboAyuda)', true,
      comunes.indexOf('<label for="campo-titulo" class="ini-rotulo ayuda-destino" data-ayuda="titulo">Título</label>') >= 0);
    Check('B13 sin "?" ni boton de ayuda', [false, false],
      [/>\s*\?\s*</.test(comunes), /<button/.test(comunes)]);
    Check('B13 sin atributo title nativo', false, / title="/.test(comunes));
    Check('B13 texto de ayuda tambien para lector de pantalla', true,
      comunes.indexOf('aria-describedby="campo-titulo-ayuda"') >= 0 &&
      comunes.indexOf('<span class="ini-sr" id="campo-titulo-ayuda">') >= 0);
    Check('B13 el globo recibe el texto del campo', I2.CAMPOS_COMUNES[0].ayuda, P.ayudaDe('titulo'));
    Check('B13 Analisis sin ayuda todavia', null, P.ayudaDe('analisis'));
    Check('B13 globo conectado al panel', true, !!P.globo && P.globo.raiz === p.sel('panel-nueva'));

    Check('B10 sin tipo: sin campos propios', true, p.sel('iniCamposTipo').hidden);
    elegirEn(p, 'selTipo', 'Mejora');
    Check('B10 Mejora pinta sus campos', true,
      p.sel('iniCamposTipo').innerHTML.indexOf('id="campo-beneficio"') >= 0 && !p.sel('iniCamposTipo').hidden);
    escribir(p, 'iniCamposComunes', 'titulo', 'T <b>');
    escribir(p, 'iniCamposTipo', 'beneficio', 'B');
    escribir(p, 'iniCamposTipo', 'alcance', 'A');
    Check('B10 captura por evento input', [{ titulo: 'T <b>' }, { beneficio: 'B', alcance: 'A' }],
      [P.solicitud.valores, P.solicitud.valoresTipo]);

    elegirEn(p, 'selPo', 'PO 1');
    Check('B10 cambio en cascada limpia solo el campo dependiente', { beneficio: 'B' }, P.solicitud.valoresTipo);
    Check('B10 y lo vuelve a pintar vacio', true,
      p.sel('iniCamposTipo').innerHTML.indexOf('id="campo-alcance" data-campo="alcance" rows="6"></textarea>') >= 0);

    elegirEn(p, 'selTipo', 'Problem');
    Check('B10 cambiar tipo borra los campos del tipo', [{}, '', true],
      [P.solicitud.valoresTipo, p.sel('iniCamposTipo').innerHTML, p.sel('iniCamposTipo').hidden]);
    Check('B10 cambiar tipo conserva el Titulo', { titulo: 'T <b>' }, P.solicitud.valores);
    elegirEn(p, 'selTipo', 'Mejora');
    Check('B10 volver al tipo: campos vacios otra vez', true,
      p.sel('iniCamposTipo').innerHTML.indexOf('id="campo-beneficio" data-campo="beneficio" value=""') >= 0);
  });
});

// B14 error 500 con {error}
pruebas.push(function () {
  var p = Pagina(nunca);
  Check('B14 cargando: todo bloqueado', [false, false, false, false], habilitados(p));
  Check('B14 cargando: mensaje', 'Cargando catálogos…', p.sel('iniEstado').textContent);
  return p.ventana.IniciativasPagina.cargar(function () {
    return Promise.resolve(Respuesta(500, { error: 'El servidor de SQL rechazo la consulta (error 208).', tipo: 'SqlException' }));
  }).then(function () {
    Check('B14 500: error visible', false, p.sel('iniError').hidden);
    Check('B14 500: mensaje del servidor', 'El servidor de SQL rechazo la consulta (error 208).', p.sel('iniErrorTexto').textContent);
    Check('B14 500: todo bloqueado', [false, false, false, false], habilitados(p));
    Check('B14 500: motivo', 'No disponible: no se pudo cargar el catálogo.', p.sel('motTipo').textContent);
    Check('B14 500: sin "Cargando" y sin campos', ['', true], [p.sel('iniEstado').textContent, p.sel('iniBloqueCampos').hidden]);
    elegirEn(p, 'selTipo', 'Mejora');
    Check('B14 500: un change sin catalogo no rompe nada', [false, false, false, false], habilitados(p));
  });
});

// B14 fallo de red, y reintento que si funciona
pruebas.push(function () {
  var p = Pagina(nunca);
  return p.ventana.IniciativasPagina.cargar(function () { return Promise.reject(new TypeError('Failed to fetch')); }).then(function () {
    Check('B14 red: mensaje', 'No se pudo conectar con el servidor.', p.sel('iniErrorTexto').textContent);
    return p.ventana.IniciativasPagina.cargar(pedirOk);
  }).then(function () {
    Check('B14 reintento: error oculto', true, p.sel('iniError').hidden);
    Check('B14 reintento: Tipo habilitado', true, !p.sel('selTipo').disabled);
  });
});

// B14 200 que no es JSON; 404; JSON viejo sin tipos
pruebas.push(function () {
  var p = Pagina(nunca);
  var P = p.ventana.IniciativasPagina;
  return P.cargar(function () { return Promise.resolve(Respuesta(200, '<html>')); }).then(function () {
    Check('B14 no JSON: mensaje', 'La respuesta del servidor no trae el catálogo esperado.', p.sel('iniErrorTexto').textContent);
    return P.cargar(function () { return Promise.resolve(Respuesta(404, '<html>')); });
  }).then(function () {
    Check('B14 404: mensaje', 'El servidor respondió 404.', p.sel('iniErrorTexto').textContent);
    return P.cargar(function () { return Promise.resolve(Respuesta(200, { asignaciones: FILAS, omitidas: 0 })); });
  }).then(function () {
    Check('B14 respuesta sin "tipos": error, no cascada a medias', [false, true],
      [p.sel('iniError').hidden, p.sel('selPo').disabled]);
  });
});

// B14 catalogo vacio + omitidas; sin tipos
pruebas.push(function () {
  var p = Pagina(nunca);
  var P = p.ventana.IniciativasPagina;
  return P.cargar(function () { return Promise.resolve(Respuesta(200, { tipos: TIPOS, asignaciones: [], omitidas: 3 })); }).then(function () {
    Check('B14 vacio: mensaje', 'No hay categorías vigentes con Director, Product Owner y Service Owner.', p.sel('iniEstado').textContent);
    Check('B14 vacio: todo bloqueado', [false, false, false, false], habilitados(p));
    Check('B14 vacio: no es error', true, p.sel('iniError').hidden);
    Check('B14 omitidas visible', false, p.sel('iniOmitidas').hidden);
    Check('B14 omitidas texto', '3 categorías vigentes no aparecen: les falta Director, Product Owner o Service Owner en el catálogo de dueños.', p.sel('iniOmitidas').textContent);
    return P.cargar(function () { return Promise.resolve(Respuesta(200, { tipos: [], asignaciones: FILAS, omitidas: 0 })); });
  }).then(function () {
    Check('B14 sin tipos: mensaje', 'No hay tipos de iniciativa en el catálogo.', p.sel('iniEstado').textContent);
    Check('B14 sin tipos: todo bloqueado', [false, false, false, false], habilitados(p));
    Check('B14 sin tipos: motivo', 'Sin tipos de iniciativa en el catálogo.', p.sel('motTipo').textContent);
  });
});

// B14 una carga vieja que llega despues de la nueva no pisa el resultado
pruebas.push(function () {
  var p = Pagina(nunca);
  var soltarVieja;
  var vieja = p.ventana.IniciativasPagina.cargar(function () {
    return new Promise(function (ok) { soltarVieja = ok; });
  });
  var nueva = p.ventana.IniciativasPagina.cargar(pedirOk);
  return nueva.then(function () {
    soltarVieja(Respuesta(500, { error: 'vieja' }));
    return vieja;
  }).then(function () {
    Check('B14 carga vieja ignorada: sin error', true, p.sel('iniError').hidden);
    Check('B14 carga vieja ignorada: Tipo habilitado', true, !p.sel('selTipo').disabled);
  });
});

// V) Vistas y borrador
function vistaVisible(p) {
  return ['panel-iniciativas', 'panel-solicitudes', 'panel-nueva'].filter(function (id) { return !p.sel(id).hidden; });
}
function pestanaActiva(p) {
  return ['tab-iniciativas', 'tab-solicitudes'].filter(function (id) { return p.sel(id).classList.contains('activa'); });
}
pruebas.push(function () {
  var p = Pagina(nunca);
  var P = p.ventana.IniciativasPagina;
  Check('V1 inicio: Iniciativas', [['panel-iniciativas'], ['tab-iniciativas']], [vistaVisible(p), pestanaActiva(p)]);
  return P.cargar(pedirOk).then(function () {
    p.sel('btnSolicitar').disparar('click');
    Check('V2 boton abre Nueva solicitud; pestaña Iniciativas sigue marcada',
      [['panel-nueva'], ['tab-iniciativas']], [vistaVisible(p), pestanaActiva(p)]);

    elegirEn(p, 'selTipo', 'Mejora');
    elegirEn(p, 'selPo', 'PO 1'); elegirEn(p, 'selSo', 'SO y'); elegirEn(p, 'selCategoria', '/A/Cat 2');
    escribir(p, 'iniCamposComunes', 'titulo', 'Mi titulo');
    escribir(p, 'iniCamposComunes', 'analisis', 'Mi analisis');

    p.sel('btnVolver').disparar('click');
    Check('V3 Volver: Iniciativas', ['panel-iniciativas'], vistaVisible(p));
    p.sel('tab-solicitudes').disparar('click');
    Check('V4 pestaña Solicitudes', [['panel-solicitudes'], ['tab-solicitudes']], [vistaVisible(p), pestanaActiva(p)]);
    p.sel('tab-iniciativas').disparar('click');

    // El DOM se "pierde" a proposito: lo que vuelve debe salir del borrador.
    ['selTipo', 'selPo', 'selSo', 'selCategoria'].forEach(function (id) { p.sel(id).value = ''; });
    p.sel('iniCamposComunes').innerHTML = '';
    p.sel('btnSolicitar').disparar('click');
    Check('V5 borrador: cascada intacta', ['Mejora', 'PO 1', 'SO y', '/A/Cat 2'], valores(p));
    Check('V5 borrador: Director', 'Dir A', p.sel('outDirector').textContent);
    var html = p.sel('iniCamposComunes').innerHTML;
    Check('V5 borrador: Titulo y Analisis', [true, true],
      [html.indexOf('value="Mi titulo"') >= 0, html.indexOf('>Mi analisis</textarea>') >= 0]);
    Check('V5 borrador: habilitados como antes', [true, true, true, true], habilitados(p));
  });
});

// V6 el HTML ya no tiene pestañas de Modificacion / Descargas / Nueva
pruebas.push(function () {
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  var tabs = (html.match(/role="tab"[^>]*id="([^"]+)"/g) || []).map(function (m) { return m.replace(/.*id="/, '').replace('"', ''); });
  Check('V6 solo dos pestañas', ['tab-iniciativas', 'tab-solicitudes'], tabs);
  Check('V6 boton con rotulo explicito', true, /Solicitar una iniciativa/.test(html));
});

// M) Barra lateral: solo enlaces de vuelta al tablero, sin Administracion
pruebas.push(function () {
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  var hrefs = (html.match(/class="mnav[^"]*" href="([^"]+)"/g) || []).map(function (m) { return m.replace(/.*href="/, '').replace('"', ''); });
  Check('M1 entradas = modulos del tablero', ['../dashboard.html#sla', '../dashboard.html#backlog', '../dashboard.html#experiencia',
    '../dashboard.html#qa', '../dashboard.html#qare', '../dashboard.html#call', '../dashboard.html#tablero'], hrefs);
  Check('M2 sin entrada activa ni hacia admin', [false, false, false],
    [/mnav active/.test(html), /aria-current/.test(html), /href="[^"]*admin/i.test(html)]);
  Check('M3 el tablero no enlaza a la pagina', false, /iniciativas\.html/.test(leer('dashboard.html')));

  // Documento propio: el de Pagina() ya tiene el boton cableado por iniciar().
  var doc = Documento();
  var raiz = doc.documentElement = Elemento('html');
  raiz.classList.add('lateral-cerrada');
  new I.MenuLateral(doc).conectar();
  var boton = doc.getElementById('lateral-plegar');
  boton.disparar('click');
  Check('M4 desplegar', [false, 'true', 'Contraer el menu'],
    [raiz.classList.contains('lateral-cerrada'), boton.getAttribute('aria-expanded'), boton.title]);
  boton.disparar('click');
  Check('M4 plegar', [true, 'false', 'Desplegar el menu'],
    [raiz.classList.contains('lateral-cerrada'), boton.getAttribute('aria-expanded'), boton.title]);
});

// P) Nada se persiste
pruebas.push(function () {
  var llamadas = [];
  function espia(url, opciones) { llamadas.push([url, opciones && opciones.method]); return pedirOk(); }
  var p = Pagina(espia);   // iniciar() usa el fetch por omision -> el espia
  return Promise.resolve().then(function () { return new Promise(function (ok) { setTimeout(ok, 0); }); }).then(function () {
    elegirEn(p, 'selTipo', 'Mejora');
    elegirEn(p, 'selPo', 'PO 1'); elegirEn(p, 'selSo', 'SO x'); elegirEn(p, 'selCategoria', '/A/Cat 1');
    escribir(p, 'iniCamposComunes', 'titulo', 'x');
    escribir(p, 'iniCamposComunes', 'analisis', 'y');
    return new Promise(function (ok) { setTimeout(ok, 0); });
  }).then(function () {
    Check('P1 una sola peticion en todo el flujo: GET del catalogo',
      [['../handlers/admin_iniciativas_catalogos.ashx', undefined]], llamadas);
    var js = leer('admin/iniciativas.js'), html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
    Check('P2 el JS no envia nada', [false, false, false, false],
      [/method\s*:/.test(js), /XMLHttpRequest/.test(js), /sendBeacon/.test(js), /['"]POST['"]/i.test(js)]);
    Check('P3 el HTML no tiene <form> ni submit', [false, false], [/<form/i.test(html), /type="submit"/i.test(html)]);
    var ashx = leer('handlers/admin_iniciativas_catalogos.ashx').split('\n')
      .filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
    Check('P4 el handler no escribe en la base', false, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP)\b/i.test(ashx));
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
