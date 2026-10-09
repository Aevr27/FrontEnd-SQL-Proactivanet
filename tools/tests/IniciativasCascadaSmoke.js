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
  (new Function('window', 'document', 'Catalogos', 'Escape', 'fetch', leer('admin/registro-iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, pedir);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.GloboAyuda, pedir);
  // Nueva solicitud es de ADM y MOD y no abre sin rol (falla cerrado). Las
  // pruebas de siempre corren como MOD, el rol mas bajo que la usa; la parte
  // RS prueba ADM, sin rol y lo que MOD no puede abrir.
  var rol = arguments.length >= 3 ? arguments[2] : 'MOD';
  if (rol) ventana.IniciativasPagina.fijarRol(rol);
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
// Tipo de iniciativa = dbo.CatPrefijoProblem: viaja el Prefijo, se ve la
// Descripcion. TIPOS son los prefijos (lo que valen los <option>).
var NOMBRES = { ADO: 'Adopción', MAP: 'Mejora aplicativo', PRB: 'Problem' };
function Tipos(lista) {
  return lista.map(function (t) { return { prefijo: t, nombre: NOMBRES[t] || t }; });
}
var TIPOS = ['ADO', 'MAP', 'PRB'];
var JSON_OK = { tipos: Tipos(TIPOS), rutas: FILAS, omitidas: 0 };
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
var cat = I.CatalogoIniciativas.desdeJson({ tipos: [{ prefijo: 'MAP' }, { prefijo: '' }, 3, 'MAP', { prefijo: 'MAP', nombre: 'otro' },
  { prefijo: 'PRB', nombre: 'Problem' }, null], rutas: [
  FILAS[0], { director: 'X', po: 'Y', so: '', categoria: 'Z' }, { director: 'X', po: 1, so: 'S', categoria: 'Z' }, null
], rutas_sin_duenos: '1', rutas_duenos_no_vigentes: 1 });
Check('A7 desdeJson descarta filas incompletas', 1, cat.asignaciones.length);
Check('A7 desdeJson descarta tipos vacios, sin prefijo y repetidos', ['MAP', 'PRB'], cat.tipos);
Check('A7 texto: Descripcion, o el prefijo si no trae', ['MAP', 'Problem'], [cat.nombreTipo('MAP'), cat.nombreTipo('PRB')]);
Check('A7 desdeJson omitidas = sin dueños + dueños no vigentes', 2, cat.omitidas);
var lanzo = 0;
try { I.CatalogoIniciativas.desdeJson({ error: 'x' }); } catch (err) { lanzo++; }
try { I.CatalogoIniciativas.desdeJson({ rutas: [] }); } catch (err) { lanzo++; }
Check('A7 sin asignaciones o sin tipos lanza', 2, lanzo);

// ---------------------------------------------------------------------------
// T) SolicitudNueva
// ---------------------------------------------------------------------------
var DEFS = {
  'MAP': { campos: [
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
Check('T3 tipo valido aceptado', true, s.elegirTipo('MAP'));
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
s.elegirTipo('PRB');
Check('T4 cambiar tipo limpia PO/SO/Categoria/Director', ['', '', '', ''],
  s.cascada.seleccion.concat([s.cascada.director()]));
Check('T10 cambiar tipo limpia los campos del tipo', {}, s.valoresTipo);
Check('T10 el tipo nuevo no tiene campos propios', [], s.camposTipo());
Check('T11/12 cambiar tipo conserva Titulo y Analisis', { titulo: 'Mi titulo', analisis: 'Mi analisis' }, s.valores);
s.elegirTipo('');
Check('T4 volver a sin tipo bloquea la cascada', false, s.estado().niveles[0].habilitado);

var sinTipos = new I.SolicitudNueva(I.CatalogoIniciativas.desdeJson({ tipos: [], rutas: FILAS }), DEFS);
Check('T1 sin tipos: select bloqueado', [false, 'Sin tipos de iniciativa en el catálogo.'],
  [sinTipos.estado().tipo.habilitado, sinTipos.estado().tipo.motivo]);

Check('T11 campo comun Titulo', ['titulo', 'Título', 'texto'],
  [I.CAMPOS_COMUNES[0].clave, I.CAMPOS_COMUNES[0].etiqueta, I.CAMPOS_COMUNES[0].control]);
Check('T12 campo comun Analisis multilinea', ['analisis', 'multilinea'],
  [I.CAMPOS_COMUNES[1].clave, I.CAMPOS_COMUNES[1].control]);
Check('T10 DEFINICIONES_TIPO vacio: ningun campo de tipo inventado', [], Object.keys(I.DEFINICIONES_TIPO));

// ---------------------------------------------------------------------------
// N) Campos nuevos de Nueva solicitud: solo los de fuente verificada
// ---------------------------------------------------------------------------
(function () {
  function campo(clave) { return I.CAMPOS_COMUNES.filter(function (x) { return x.clave === clave; })[0]; }
  Check('N1 campos comunes, en orden y por seccion',
    ['titulo:info', 'analisis:info', 'observaciones:info', 'volumetria:impacto', 'pct:impacto'],
    I.CAMPOS_COMUNES.map(function (x) { return x.clave + ':' + x.seccion; }));
  Check('N1 Descripcion: se ve como Descripcion, la clave sigue siendo analisis, destino Problem.Descripcion',
    ['Descripción', 'dbo.Problem.Descripcion'], [campo('analisis').etiqueta, campo('analisis').destino]);
  Check('N2 Observaciones: multilinea, dbo.Problem.Observaciones, con su ayuda',
    ['multilinea', 'dbo.Problem.Observaciones', 'Información adicional sobre cuándo, dónde y en qué condiciones se presenta la afectación.'],
    [campo('observaciones').control, campo('observaciones').destino, campo('observaciones').ayuda.texto]);
  Check('N3 Volumetria: entero y destino SIN confirmar (null)', ['entero', null],
    [campo('volumetria').control, campo('volumetria').destino]);
  Check('N4 %: porcentaje, por categoria, se reinicia con la cascada', ['porcentaje', true, true],
    [campo('pct').control, campo('pct').requiereCategoria, campo('pct').reiniciaConCascada]);
  Check('N5 ningun campo de los pendientes se inventa',
    [], I.CAMPOS_COMUNES.map(function (x) { return x.clave; }).filter(function (k) {
      return /codigo|fecha|estado|subestado|gerencia|macroproceso|causa|proceso|comentario|wa|ultimo|rca/i.test(k);
    }));

  var V = I.VALIDAR;
  Check('N6 entero: vacio, 0 y enteros validos', ['', '', ''], [V.entero(''), V.entero('0'), V.entero('1250')]);
  Check('N6 entero: negativos, decimales y texto no', [true, true, true, true],
    [!!V.entero('-1'), !!V.entero('2.5'), !!V.entero('abc'), !!V.entero('1e3')]);
  Check('N7 %: 0, 35, 100 y dos decimales validos', ['', '', '', ''], [V.porcentaje('0'), V.porcentaje('35'), V.porcentaje('100'), V.porcentaje('12.25')]);
  Check('N7 %: sin regla de multiplos de 5 (no esta verificada)', '', V.porcentaje('37'));
  Check('N7 %: mas de 100, negativo, tres decimales, texto no', [true, true, true, true],
    [!!V.porcentaje('100.01'), !!V.porcentaje('-5'), !!V.porcentaje('1.234'), !!V.porcentaje('x')]);
  Check('N8 % se guardaria como fraccion de PctDisminucion (1.0000 = 100%)',
    [1, 0.35, 0.1225, 0, null, null], [I.fraccionDe('100'), I.fraccionDe('35'), I.fraccionDe('12.25'), I.fraccionDe('0'), I.fraccionDe(''), I.fraccionDe('150')]);

  var n = new I.SolicitudNueva(I.CatalogoIniciativas.desdeJson(JSON_OK));
  n.elegirTipo('MAP');
  n.capturar('pct', '50');
  Check('N9 % sin Categoria: bloqueado y no se captura', [false, 'Elige primero la Categoría en Clasificación.', undefined],
    [n.estado().pct.habilitado, n.estado().pct.motivo, n.valores.pct]);
  n.elegir(0, 'PO 1'); n.elegir(1, 'SO y'); n.elegir(2, '/A/Cat 2');
  Check('N9 la Categoria sale de la cascada (no hay otro selector)', '/A/Cat 2', n.categoria());
  n.capturar('pct', '50'); n.capturar('volumetria', '300'); n.capturar('observaciones', 'Los lunes');
  Check('N9 con Categoria: habilitado y capturado', [true, '50', 0.5], [n.estado().pct.habilitado, n.valores.pct, n.pctFraccion()]);
  Check('N9 Director derivado intacto', 'Dir A', n.estado().director.valor);
  n.capturar('volumetria', '2.5');
  Check('N10 error de volumetria', 'Escribe un número entero, de 0 en adelante.', n.error('volumetria'));
  n.elegir(2, '/A/Cat 2');
  Check('N11 tocar la cascada vacia el %, no Volumetria ni Observaciones',
    [undefined, '2.5', 'Los lunes'], [n.valores.pct, n.valores.volumetria, n.valores.observaciones]);
  n.capturar('pct', '20');
  n.elegirTipo('PRB');
  Check('N11 cambiar tipo vacia el % (la Categoria se va)', [undefined, '', false],
    [n.valores.pct, n.categoria(), n.estado().pct.habilitado]);
  Check('N12 sin valores por omision: nada capturado de inicio',
    {}, new I.SolicitudNueva(I.CatalogoIniciativas.desdeJson(JSON_OK)).valores);
})();

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
    Check('B1 URL del handler: pide las rutas reales', '../handlers/admin_iniciativas_catalogos.ashx?rutas=1', urls[urls.length - 1]);
    Check('B1 cargado: solo Tipo habilitado', [true, false, false, false], habilitados(p));
    Check('B1 tipos en el select (valor = prefijo)', TIPOS, p.sel('selTipo').opciones());
    Check('B1 el select muestra la Descripcion', true,
      /<option value="ADO">Adopción<\/option><option value="MAP">Mejora aplicativo<\/option><option value="PRB">Problem<\/option>/.test(p.sel('selTipo').innerHTML));
    Check('B1 motivo PO', 'Elige primero un Tipo de iniciativa.', p.sel('motPo').textContent);
    Check('B1 Director vacio', ['—', 'Se completa al elegir la Categoría.'],
      [p.sel('outDirector').textContent, p.sel('motDirector').textContent]);
    Check('B1 campos ocultos sin tipo, aviso visible', [true, false],
      [p.sel('iniBloqueCampos').hidden, p.sel('iniCamposPendiente').hidden]);
    Check('B1 sin error ni omitidas', [true, true], [p.sel('iniError').hidden, p.sel('iniOmitidas').hidden]);

    elegirEn(p, 'selTipo', 'Inventado');
    Check('B2 tipo invalido: rechazado, cascada bloqueada', ['', false], [p.sel('selTipo').value, !p.sel('selPo').disabled]);

    elegirEn(p, 'selTipo', 'MAP');
    Check('B3 tipo habilita PO', [true, true, false, false], habilitados(p));
    Check('B3 tipo muestra campos y quita el aviso', [false, true],
      [p.sel('iniBloqueCampos').hidden, p.sel('iniCamposPendiente').hidden]);

    elegirEn(p, 'selPo', 'PO 1');
    elegirEn(p, 'selSo', 'SO y');
    elegirEn(p, 'selCategoria', '/A/Cat 2');
    Check('B5 cadena completa', ['MAP', 'PO 1', 'SO y', '/A/Cat 2'], valores(p));
    Check('B8 Director derivado', 'Dir A', p.sel('outDirector').textContent);
    Check('B9 Director es texto, no select', ['', 'Derivado de la categoría.'],
      [p.sel('outDirector').innerHTML, p.sel('motDirector').textContent]);

    elegirEn(p, 'selSo', 'SO x');
    Check('B7 cambiar SO limpia Categoria', ['MAP', 'PO 1', 'SO x', ''], valores(p));
    Check('B7 cambiar SO limpia Director', '—', p.sel('outDirector').textContent);
    elegirEn(p, 'selCategoria', '/A/Cat 1');
    Check('B8 otra categoria recalcula Director', 'Dir A', p.sel('outDirector').textContent);

    elegirEn(p, 'selPo', 'PO 3');
    Check('B6 cambiar PO limpia SO/Categoria', ['MAP', 'PO 3', '', ''], valores(p));
    Check('B6 cambiar PO limpia Director', '—', p.sel('outDirector').textContent);
    Check('B6 SO habilitado, Categoria bloqueada', [true, true, true, false], habilitados(p));
    Check('B6 SO sin opciones viejas', ['SO z'], p.sel('selSo').opciones());
    Check('B6 motivo Categoria', 'Elige primero un Service Owner.', p.sel('motCategoria').textContent);

    elegirEn(p, 'selSo', 'SO z'); elegirEn(p, 'selCategoria', '/B/Cat 4');
    Check('B8 Director de Dir B', 'Dir B', p.sel('outDirector').textContent);
    elegirEn(p, 'selTipo', 'PRB');
    Check('B4 cambiar tipo limpia PO/SO/Categoria', ['PRB', '', '', ''], valores(p));
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
  I2.DEFINICIONES_TIPO['MAP'] = DEFS['MAP'];
  var P = p.ventana.IniciativasPagina;
  return P.cargar(pedirOk).then(function () {
    var comunes = p.sel('iniCamposComunes').innerHTML;
    Check('B11 Titulo: input de texto', true, comunes.indexOf('<input type="text" id="campo-titulo" data-campo="titulo"') >= 0);
    Check('B12 Analisis: textarea', true, comunes.indexOf('<textarea id="campo-analisis" data-campo="analisis" rows="6" aria-describedby="campo-analisis-ayuda">') >= 0);
    Check('B13 rotulo Titulo es el destino de la ayuda (clase de GloboAyuda)', true,
      comunes.indexOf('<label for="campo-titulo" class="ini-rotulo ayuda-destino" data-ayuda="titulo">Título</label>') >= 0);
    Check('B13 sin "?" ni boton de ayuda', [false, false],
      [/>\s*\?\s*</.test(comunes), /<button/.test(comunes)]);
    Check('B13 sin atributo title nativo', false, / title="/.test(comunes));
    Check('B13 texto de ayuda tambien para lector de pantalla', true,
      comunes.indexOf('aria-describedby="campo-titulo-ayuda"') >= 0 &&
      comunes.indexOf('<span class="ini-sr" id="campo-titulo-ayuda">') >= 0);
    Check('B13 el globo recibe el texto del campo', I2.CAMPOS_COMUNES[0].ayuda, P.ayudaDe('titulo'));
    Check('B13 textos de ayuda de la plantilla de Problem',
      ['Nombre descriptivo del problema que permita identificar la afectación y su causa principal.',
       'Detalle del síntoma o comportamiento observado que origina el problema.'],
      [P.ayudaDe('titulo').texto, P.ayudaDe('analisis').texto]);
    Check('B13 rotulo Analisis tambien es destino de la ayuda', true,
      comunes.indexOf('class="ini-rotulo ayuda-destino" data-ayuda="analisis"') >= 0 &&
      comunes.indexOf('aria-describedby="campo-analisis-ayuda"') >= 0);
    Check('B13 globo conectado al panel', true, !!P.globo && P.globo.raiz === p.sel('panel-nueva'));

    Check('B10 sin tipo: sin campos propios', true, p.sel('iniCamposTipo').hidden);
    elegirEn(p, 'selTipo', 'MAP');
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

    elegirEn(p, 'selTipo', 'PRB');
    Check('B10 cambiar tipo borra los campos del tipo', [{}, '', true],
      [P.solicitud.valoresTipo, p.sel('iniCamposTipo').innerHTML, p.sel('iniCamposTipo').hidden]);
    Check('B10 cambiar tipo conserva el Titulo', { titulo: 'T <b>' }, P.solicitud.valores);
    elegirEn(p, 'selTipo', 'MAP');
    Check('B10 volver al tipo: campos vacios otra vez', true,
      p.sel('iniCamposTipo').innerHTML.indexOf('id="campo-beneficio" data-campo="beneficio" value=""') >= 0);
  });
});

// N13-N20 los campos nuevos en la pagina
pruebas.push(function () {
  var p = Pagina(nunca);
  var P = p.ventana.IniciativasPagina;
  return P.cargar(pedirOk).then(function () {
    var info = p.sel('iniCamposComunes').innerHTML, imp = p.sel('iniCamposImpacto').innerHTML;
    Check('N13 02: Titulo, Descripcion y Observaciones', [true, true, true],
      [info.indexOf('id="campo-titulo"') >= 0, />Descripción<\/label>/.test(info),
       info.indexOf('<textarea id="campo-observaciones" data-campo="observaciones" rows="6" aria-describedby="campo-observaciones-ayuda">') >= 0]);
    Check('N13 03: Volumetria y % fuera de 02', [false, true, true],
      [info.indexOf('campo-volumetria') >= 0, imp.indexOf('id="campo-volumetria"') >= 0, imp.indexOf('id="campo-pct"') >= 0]);
    Check('N14 Volumetria: numero entero >= 0', true,
      imp.indexOf('<input type="number" id="campo-volumetria" data-campo="volumetria" aria-describedby="campo-volumetria-ayuda campo-volumetria-msg" inputmode="numeric" min="0" step="1" value="">') >= 0);
    Check('N15 %: numero 0-100, paso 0.01, bloqueado sin categoria, con sufijo', [true, true],
      [imp.indexOf('type="number" id="campo-pct" data-campo="pct" aria-describedby="campo-pct-msg" inputmode="decimal" min="0" max="100" step="0.01" disabled value="">') >= 0,
       imp.indexOf('<span class="ini-pct-sufijo" aria-hidden="true">%</span>') >= 0]);
    Check('N16 03 oculto sin tipo, con su aviso', [true, false], [p.sel('iniBloqueImpacto').hidden, p.sel('iniImpactoPendiente').hidden]);

    elegirEn(p, 'selTipo', 'MAP');
    Check('N16 con tipo: 03 visible', [false, true], [p.sel('iniBloqueImpacto').hidden, p.sel('iniImpactoPendiente').hidden]);
    Check('N17 % bloqueado hasta la Categoria', [true, 'Elige primero la Categoría en Clasificación.'],
      [p.sel('campo-pct').disabled, p.sel('campo-pct-msg').textContent]);
    elegirEn(p, 'selPo', 'PO 1'); elegirEn(p, 'selSo', 'SO y'); elegirEn(p, 'selCategoria', '/A/Cat 2');
    // pedirOk no trae capacidad: mientras tanto, "Calculando".
    Check('N17 con Categoria: habilitado; Director intacto', [false, 'Calculando la capacidad de reducción de la categoría…', 'Dir A'],
      [p.sel('campo-pct').disabled, p.sel('campo-pct-msg').textContent, p.sel('outDirector').textContent]);

    escribir(p, 'iniCamposImpacto', 'pct', '150');
    Check('N18 % fuera de rango: error visible', ['Escribe un porcentaje entre 0 y 100, con hasta dos decimales.', true, 'true'],
      [p.sel('campo-pct-msg').textContent, p.sel('campo-pct-msg').classList.contains('ini-error-campo'), p.sel('campo-pct').getAttribute('aria-invalid')]);
    escribir(p, 'iniCamposImpacto', 'pct', '35');
    Check('N18 % valido: sin error', ['Calculando la capacidad de reducción de la categoría…', false, 0.35],
      [p.sel('campo-pct-msg').textContent, p.sel('campo-pct-msg').classList.contains('ini-error-campo'), P.solicitud.pctFraccion()]);
    escribir(p, 'iniCamposImpacto', 'volumetria', '-3');
    Check('N19 Volumetria negativa: error', 'Escribe un número entero, de 0 en adelante.', p.sel('campo-volumetria-msg').textContent);
    escribir(p, 'iniCamposImpacto', 'volumetria', '420');
    escribir(p, 'iniCamposComunes', 'observaciones', 'En tienda, al cierre');
    Check('N19 captura de 02 y 03', ['420', 'En tienda, al cierre', ''],
      [P.solicitud.valores.volumetria, P.solicitud.valores.observaciones, p.sel('campo-volumetria-msg').textContent]);

    elegirEn(p, 'selSo', 'SO x');
    Check('N20 cambiar la cascada vacia y bloquea el %; Volumetria se queda', [undefined, true, true, '420'],
      [P.solicitud.valores.pct, p.sel('campo-pct').disabled,
       p.sel('iniCamposImpacto').innerHTML.indexOf('id="campo-pct" data-campo="pct"') >= 0 && /id="campo-pct"[^>]*value=""/.test(p.sel('iniCamposImpacto').innerHTML),
       P.solicitud.valores.volumetria]);

    Check('N21 ayuda de SO, Categoria y RCA (rotulos fijos)',
      ['Responsable del servicio afectado y encargado de validar el seguimiento del problema.',
       'Categoría o clasificación a la que pertenecen los incidentes considerados dentro de la volumetría del problema.', true],
      [P.ayudaDe('so').texto, P.ayudaDe('categoria').texto, /^Documento con la descripción de la causa raíz/.test(P.ayudaDe('rca').texto)]);

    // Ida y vuelta: el borrador nuevo tambien sobrevive.
    p.sel('btnVolver').disparar('click');
    p.sel('iniCamposComunes').innerHTML = ''; p.sel('iniCamposImpacto').innerHTML = '';
    p.sel('btnSolicitar').disparar('click');
    Check('N22 Observaciones y Volumetria repintadas desde el borrador', [true, true],
      [p.sel('iniCamposComunes').innerHTML.indexOf('>En tienda, al cierre</textarea>') >= 0,
       p.sel('iniCamposImpacto').innerHTML.indexOf('value="420"') >= 0]);
  });
});

// N23 marcado: secciones, RCA sin subir nada, sin segundo selector de categoria
pruebas.push(function () {
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  Check('N23 secciones 01-04 en orden', ['Clasificación', 'Información del problema', 'Impacto', 'RCA'],
    (html.match(/<h3 id="iniCab[A-Za-z]+">[^<]+<\/h3>/g) || []).map(function (h) { return h.replace(/<[^>]+>/g, ''); }));
  Check('N24 RCA: input de archivo, deshabilitado hasta el tipo', [true, true],
    [/<input type="file" id="campoRca" aria-describedby="motRca" disabled>/.test(html), /Elige primero un Tipo de iniciativa\./.test(html)]);
  Check('N24 RCA no es un campo de texto', false, /id="campoRca"[^>]*type="text"|<textarea[^>]*rca/i.test(html));
  Check('N25 una sola Categoria en el formulario', 1, (html.match(/id="selCategoria"/g) || []).length);
  Check('N26 ayuda en SO y Categoria sin cambiar los ids', [true, true],
    [/<label for="selSo" class="ini-rotulo ayuda-destino" data-ayuda="so">Service Owner<\/label>/.test(html),
     /<label for="selCategoria" class="ini-rotulo ayuda-destino" data-ayuda="categoria">Categoría<\/label>/.test(html)]);
  Check('N27 Product Owner sin renombrar a Owner Problem (no verificado)', [true, false],
    [/<label for="selPo">Product Owner<\/label>/.test(html), /Owner Problem/i.test(html)]);
  var css = leer('admin/iniciativas.css');
  Check('N28 bajo 900px una columna, sin fijar columna ni fila', true,
    /@media \(max-width: 900px\) \{[^}]*grid-template-columns: minmax\(0, 1fr\)[^}]*\}\s*\.ini-form > \.ini-col-clasif,\s*\.ini-form > \.ini-bloque:not\(\.ini-col-clasif\) \{ grid-column: auto; grid-row: auto; \}/.test(css));
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
    elegirEn(p, 'selTipo', 'MAP');
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
    return P.cargar(function () { return Promise.resolve(Respuesta(200, { rutas: FILAS, omitidas: 0 })); });
  }).then(function () {
    Check('B14 respuesta sin "tipos": error, no cascada a medias', [false, true],
      [p.sel('iniError').hidden, p.sel('selPo').disabled]);
  });
});

// B14 catalogo vacio + omitidas; sin tipos
pruebas.push(function () {
  var p = Pagina(nunca);
  var P = p.ventana.IniciativasPagina;
  return P.cargar(function () { return Promise.resolve(Respuesta(200, { tipos: Tipos(TIPOS), rutas: [], rutas_sin_duenos: 3 })); }).then(function () {
    Check('B14 vacio: mensaje', 'No hay categorías activas con Director, Product Owner y Service Owner.', p.sel('iniEstado').textContent);
    Check('B14 vacio: todo bloqueado', [false, false, false, false], habilitados(p));
    Check('B14 vacio: no es error', true, p.sel('iniError').hidden);
    Check('B14 omitidas visible', false, p.sel('iniOmitidas').hidden);
    Check('B14 omitidas texto', '3 categorías activas no aparecen: no tienen Director, Product Owner y Service Owner vigentes en el catálogo de dueños.', p.sel('iniOmitidas').textContent);
    return P.cargar(function () { return Promise.resolve(Respuesta(200, { tipos: [], rutas: FILAS, omitidas: 0 })); });
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

    elegirEn(p, 'selTipo', 'MAP');
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
    Check('V5 borrador: cascada intacta', ['MAP', 'PO 1', 'SO y', '/A/Cat 2'], valores(p));
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
    '../dashboard.html#qa', '../dashboard.html#qare', '../dashboard.html#call', '../dashboard.html#tablero',
    'iniciativas.html'], hrefs);
  // Administracion: la UNICA entrada activa, y oculta hasta que SesionAdmin
  // confirma la cuenta (data-solo-admin hidden). Es solo UX: el acceso lo
  // decide el servidor (AccesoAdmin).
  var activas = html.match(/class="mnav active"[^>]*>/g) || [];
  Check('M2 una sola entrada activa: Administracion', [1, true],
    [activas.length, /href="iniciativas\.html"[^>]*aria-current="page"/.test(activas[0] || '')]);
  var tablero = leer('dashboard.html').replace(/<!--[\s\S]*?-->/g, '');
  Check('M3 el tablero enlaza a la pagina solo desde una entrada oculta',
    [true, true, true],
    [/<li data-solo-admin hidden>\s*<a class="mnav" id="mnav-admin" href="admin\/iniciativas\.html"/.test(tablero),
     (tablero.match(/iniciativas\.html/g) || []).length === 1,
     /<li data-solo-admin hidden>\s*<a class="mnav active" href="iniciativas\.html"/.test(html)]);

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

// S) Solicitud: Problem primero, RCA condicional, requeridos, capacidad y
//    validacion en el servidor (con un `pedir` que enruta por URL).
function enrutador(capacidades, validar, registro) {
  return function (url, opciones) {
    registro && registro.push([url, opciones && opciones.method, opciones && opciones.body]);
    if (url.indexOf('admin_iniciativas_capacidad.ashx') >= 0) {
      var cat = decodeURIComponent(url.split('categoria=')[1]);
      return Promise.resolve(capacidades[cat] ? Respuesta(200, capacidades[cat]) : Respuesta(500, { error: 'x' }));
    }
    if (url.indexOf('admin_iniciativas_validar.ashx') >= 0) return Promise.resolve(validar());
    return Promise.resolve(Respuesta(200, {
      tipos: Tipos(['PRB', 'ADO', 'MAP']), tipo_problem: 'PRB', rutas: FILAS, omitidas: 0
    }));
  };
}
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

pruebas.push(function () {
  var cat = I.CatalogoIniciativas.desdeJson({ tipos: Tipos(['PRB', 'ADO']), tipo_problem: 'PRB', rutas: FILAS });
  Check('S1 el orden de tipos es el del servidor (Problem primero)', ['PRB', 'ADO'], cat.tipos);
  Check('S1 tipo_problem', 'PRB', cat.tipoProblem);
  Check('S2 tipo_problem fuera de la lista se ignora', '',
    I.CatalogoIniciativas.desdeJson({ tipos: Tipos(['ADO']), tipo_problem: 'PRB', rutas: FILAS }).tipoProblem);
  Check('S2 sin tipo_problem: ningun tipo exige RCA', false,
    (function () { var n = new I.SolicitudNueva(I.CatalogoIniciativas.desdeJson(JSON_OK)); n.elegirTipo('PRB'); return n.rcaObligatorio(); })());

  // RCA condicional
  var s = new I.SolicitudNueva(cat);
  s.elegirTipo('PRB');
  Check('S3 Problem: RCA obligatorio', [true, 'Obligatorio para Problem. El archivo todavía no se guarda.'],
    [s.estado().rca.obligatorio, s.estado().rca.motivo]);
  Check('S3 Problem sin RCA: falta rca', true, s.faltantes().indexOf('rca') >= 0);
  s.elegirRca({ name: 'x.pdf', size: 10 });
  Check('S3 Problem con RCA: no falta', false, s.faltantes().indexOf('rca') >= 0);
  s.elegirRca({ name: 'vacio.pdf', size: 0 });
  Check('S3 archivo vacio no cuenta', true, s.faltantes().indexOf('rca') >= 0);
  s.elegirTipo('ADO');
  Check('S4 otro tipo: RCA opcional', [false, false], [s.rcaObligatorio(), s.faltantes().indexOf('rca') >= 0]);

  // Requeridos
  var r = new I.SolicitudNueva(cat);
  Check('S5 todo vacio: faltan todos menos RCA (sin tipo)',
    ['tipo', 'po', 'so', 'categoria', 'titulo', 'analisis', 'observaciones', 'volumetria', 'pct'], r.faltantes());
  r.elegirTipo('ADO'); r.elegir(0, 'PO 1'); r.elegir(1, 'SO x'); r.elegir(2, '/A/Cat 1');
  r.capturar('titulo', 'T'); r.capturar('analisis', 'D'); r.capturar('observaciones', 'O');
  r.capturar('volumetria', '10'); r.capturar('pct', '20');
  Check('S6 completa: sin faltantes ni errores', [[], []], [r.faltantes(), r.erroresCliente()]);
  r.capturar('observaciones', '   ');
  Check('S6 solo espacios cuenta como vacio', ['observaciones'], r.faltantes());
  r.capturar('observaciones', 'O');
  Check('S7 campos de envio (Descripcion = analisis)',
    { tipo: 'ADO', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1', titulo: 'T', descripcion: 'D',
      observaciones: 'O', volumetria: '10', pct: '20', disponible_cliente: '' }, r.camposEnvio());

  // Capacidad
  var cap = r.pedirCapacidad();
  Check('S8 pidiendo: Calculando', 'Calculando la capacidad de reducción de la categoría…', r.estado().pct.motivo);
  Check('S8 respuesta de otra categoria se descarta', false, r.fijarCapacidad('/A/Cat 2', { disponible: 0.1, determinable: true }));
  r.fijarCapacidad(cap, { disponible: 0.4, determinable: true });
  Check('S9 disponible 40%', ['Capacidad de reducción · Disponible: 40%. Puedes solicitar entre 0% y 40%.', 40],
    [r.estado().pct.motivo, r.estado().pct.max]);
  r.capturar('pct', '40');
  Check('S9 40% cabe', '', r.error('pct'));
  r.capturar('pct', '40.01');
  Check('S10 40.01% no cabe', 'Esta categoría solo tiene 40% disponible.', r.error('pct'));
  r.capturar('pct', '33');
  Check('S10 33% (sin multiplos de 5) cabe', '', r.error('pct'));
  r.fijarCapacidad(cap, { disponible: 0.3333, determinable: true });
  r.capturar('pct', '33.33');
  Check('S11 33.33 con 33.33 disponible: sin error de flotantes', ['', 33.33], [r.error('pct'), r.maxPct()]);
  r.fijarCapacidad(cap, { disponible: 0, determinable: true });
  r.capturar('pct', '0');
  Check('S12 0% con 0 disponible cabe', '', r.error('pct'));
  r.fijarCapacidad(cap, { disponible: 1, determinable: false });
  Check('S13 no determinable: aviso y error', [true, 'No se puede calcular la capacidad de esta categoría.'],
    [/Capacidad no determinable/.test(r.estado().pct.motivo), r.error('pct')]);
  r.fallaCapacidad(cap);
  Check('S14 error de capacidad: no bloquea, el servidor decide', ['', true],
    [r.error('pct'), /el servidor la revisará al validar/.test(r.estado().pct.motivo)]);
  r.elegir(2, '/A/Cat 1');
  r.elegir(1, 'SO y');
  Check('S15 cambiar la cascada borra la capacidad', null, r.capacidad);
  r.elegir(2, '/A/Cat 2');
  r.fijarCapacidad(r.pedirCapacidad(), { disponible: 0.5, determinable: true });
  r.elegirTipo('MAP');
  Check('S15 cambiar el tipo borra la capacidad', null, r.capacidad);
});

// S16-S22 en la pagina: GET de capacidad, tope del %, RCA y POST de validacion
pruebas.push(function () {
  var llamadas = [];
  var respuestaValidar = function () { return Respuesta(200, { valida: true, errores: [], guardada: false, numero_solicitud: null }); };
  var p = Pagina(nunca);
  var P = p.ventana.IniciativasPagina;
  var pedir = enrutador({
    '/A/Cat 1': { categoria: '/A/Cat 1', disponible: 0.4, determinable: true },
    '/A/Cat 2': { categoria: '/A/Cat 2', disponible: 0.3, determinable: true }
  }, function () { return respuestaValidar(); }, llamadas);
  return P.cargar(pedir).then(function () {
    Check('S16 selector: Problem primero', ['PRB', 'ADO', 'MAP'], p.sel('selTipo').opciones());
    Check('S16 RCA bloqueado sin tipo', [true, 'Elige primero un Tipo de iniciativa.'], [p.sel('campoRca').disabled, p.sel('motRca').textContent]);
    elegirEn(p, 'selTipo', 'PRB');
    Check('S17 Problem: RCA habilitado y obligatorio', [false, 'true', false],
      [p.sel('campoRca').disabled, p.sel('campoRca').getAttribute('aria-required'), p.sel('rotRcaObligatorio').hidden]);
    elegirEn(p, 'selPo', 'PO 1'); elegirEn(p, 'selSo', 'SO x'); elegirEn(p, 'selCategoria', '/A/Cat 1');
    return esperar();
  }).then(function () {
    Check('S18 capacidad pedida y pintada', ['Capacidad de reducción · Disponible: 40%. Puedes solicitar entre 0% y 40%.', '40'],
      [p.sel('campo-pct-msg').textContent, p.sel('campo-pct').getAttribute('max')]);
    escribir(p, 'iniCamposImpacto', 'pct', '50');
    Check('S18 50% marcado en rojo', ['Esta categoría solo tiene 40% disponible.', 'true'],
      [p.sel('campo-pct-msg').textContent, p.sel('campo-pct').getAttribute('aria-invalid')]);

    // Validar con faltantes: no sale nada al servidor.
    var antes = llamadas.length;
    return P.validar().then(function () {
      Check('S19 faltantes: no hay POST', antes, llamadas.length);
      var html = p.sel('iniResultado').innerHTML;
      Check('S19 lista lo que falta, RCA incluido', [true, true, true, true],
        [/Título: Falta Título\./.test(html), /RCA: El RCA es obligatorio para Problem\./.test(html),
         /% Disminución: Esta categoría solo tiene 40% disponible\./.test(html), p.sel('iniResultado').classList.contains('mal')]);
    });
  }).then(function () {
    escribir(p, 'iniCamposComunes', 'titulo', 'T');
    escribir(p, 'iniCamposComunes', 'analisis', 'D');
    escribir(p, 'iniCamposComunes', 'observaciones', 'O');
    escribir(p, 'iniCamposImpacto', 'volumetria', '10');
    escribir(p, 'iniCamposImpacto', 'pct', '40');
    var rca = p.sel('campoRca');
    rca.files = [new File(['%PDF'], 'RCA_v7.pdf')];   // File real: FormData lo exige
    rca.disparar('change');
    return P.validar();
  }).then(function () {
    var post = llamadas.filter(function (l) { return l[1] === 'POST'; });
    Check('S20 un solo POST, a validar', [1, '../handlers/admin_iniciativas_validar.ashx'], [post.length, post[0] && post[0][0]]);
    var cuerpo = post[0][2];
    Check('S20 cuerpo: campos y archivo', ['PRB', '/A/Cat 1', 'D', '40', '40', 'RCA_v7.pdf'],
      [cuerpo.get('tipo'), cuerpo.get('categoria'), cuerpo.get('descripcion'), cuerpo.get('pct'),
       cuerpo.get('disponible_cliente'), cuerpo.get('rca') && cuerpo.get('rca').name]);
    Check('S20 valida: avisa que no se guardo', [true, true],
      [/No se guardó/.test(p.sel('iniResultado').innerHTML), p.sel('iniResultado').classList.contains('ok')]);

    // Concurrencia: el navegador cree 40%, pero el servidor ya ve 30% y
    // rechaza. La pantalla muestra lo que dijo el servidor.
    respuestaValidar = function () {
      return Respuesta(422, { valida: false, errores: [{ campo: 'pct', mensaje: 'La categoria solo tiene 30% de capacidad disponible.' }] });
    };
    return P.validar();
  }).then(function () {
    Check('S21 rechazo del servidor manda aunque el navegador diga 40%', [true, true, true],
      [/El servidor rechazó la solicitud/.test(p.sel('iniResultado').innerHTML),
       /30% de capacidad disponible/.test(p.sel('iniResultado').innerHTML), p.sel('iniResultado').classList.contains('mal')]);
    respuestaValidar = function () { return Respuesta(403, { error: 'No tienes acceso a la administracion de iniciativas.', tipo: 'AccesoDenegado' }); };
    return P.validar();
  }).then(function () {
    Check('S22 403 del servidor se muestra', true, /No tienes acceso/.test(p.sel('iniResultado').innerHTML));
    Check('S22 el boton se rehabilita', false, p.sel('btnValidar').disabled);
  });
});

// P) Nada se persiste
pruebas.push(function () {
  var llamadas = [];
  function espia(url, opciones) { llamadas.push([url, opciones && opciones.method]); return pedirOk(); }
  var p = Pagina(espia);   // iniciar() usa el fetch por omision -> el espia
  return Promise.resolve().then(function () { return new Promise(function (ok) { setTimeout(ok, 0); }); }).then(function () {
    elegirEn(p, 'selTipo', 'MAP');
    elegirEn(p, 'selPo', 'PO 1'); elegirEn(p, 'selSo', 'SO x'); elegirEn(p, 'selCategoria', '/A/Cat 1');
    escribir(p, 'iniCamposComunes', 'titulo', 'x');
    escribir(p, 'iniCamposComunes', 'analisis', 'y');
    return new Promise(function (ok) { setTimeout(ok, 0); });
  }).then(function () {
    // Dos GET al abrir (registro y catalogo, en paralelo) y el GET de la
    // capacidad al elegir la Categoria. Sin "Validar", ningun POST.
    Check('P1 solo GET de lectura en el flujo de captura',
      [['../handlers/admin_iniciativas_capacidad.ashx?categoria=%2FA%2FCat%201', null],
       ['../handlers/admin_iniciativas_catalogos.ashx?rutas=1', null],
       ['../handlers/admin_iniciativas_registro.ashx', null]],
      llamadas.map(function (l) { return [l[0], l[1] || null]; }).sort());
    var js = leer('admin/iniciativas.js') + leer('admin/registro-iniciativas.js'), html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
    // El unico envio es el POST de validacion, que no guarda.
    Check('P2 el unico POST es a admin_iniciativas_validar', [1, 1, true, false, false],
      [(js.match(/method\s*:/g) || []).length, (js.match(/['"]POST['"]/gi) || []).length,
       /pedir\(URL_VALIDAR, \{ method: 'POST'/.test(js), /XMLHttpRequest/.test(js), /sendBeacon/.test(js)]);
    Check('P3 el HTML no tiene <form> ni submit', [false, false], [/<form/i.test(html), /type="submit"/i.test(html)]);
    var ashx = (leer('handlers/admin_iniciativas_catalogos.ashx') + leer('handlers/admin_iniciativas_registro.ashx') +
                leer('handlers/admin_iniciativas_capacidad.ashx') + leer('handlers/admin_iniciativas_validar.ashx') +
                leer('App_Code/ExperienciaRegistro.cs') + leer('App_Code/ExperienciaCapacidad.cs') +
                leer('App_Code/IniciativaService.cs') + leer('App_Code/SolicitudIniciativa.cs')).split('\n')
      .filter(function (l) { return !/^\s*\/\//.test(l); }).join('\n');
    Check('P4 el handler no escribe en la base', false, /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|CREATE|ALTER|DROP)\b/i.test(ashx));
  });
});

// ---------------------------------------------------------------------------
// RS) Roles de Nueva solicitud: ADM y MOD la abren; sin rol no (falla
//     cerrado); MOD nunca abre la creacion directa; el RCA de Problem sigue
//     obligatorio para quien solicita.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var conProblem = { tipos: Tipos(TIPOS), rutas: FILAS, tipo_problem: 'PRB' };
  var sinRol = Pagina(nunca, null, null), adm = Pagina(nunca, null, 'ADM'), mod = Pagina(nunca, null, 'MOD');
  var cargas = [sinRol, adm, mod].map(function (p) {
    return p.ventana.IniciativasPagina.cargar(function () { return Promise.resolve(Respuesta(200, conProblem)); });
  });
  return Promise.all(cargas).then(function () {
    sinRol.sel('btnSolicitar').disparar('click');
    Check('RS1 sin rol: Solicitar no abre', ['panel-iniciativas'], vistaVisible(sinRol));
    adm.sel('btnSolicitar').disparar('click');
    Check('RS2 ADM: abre Nueva solicitud', ['panel-nueva'], vistaVisible(adm));
    mod.sel('btnSolicitar').disparar('click');
    Check('RS3 MOD: abre Nueva solicitud', ['panel-nueva'], vistaVisible(mod));

    var P = mod.ventana.IniciativasPagina;
    P.mostrarVista('iniciativas');
    mod.sel('btnCrearAdmin').disparar('click');
    P.mostrarVista('crear');
    Check('RS4 MOD: la creacion directa no abre (boton ni llamada directa)', ['iniciativas', true],
      [P.vista, mod.sel('panel-crear-admin').hidden]);

    P.mostrarVista('nueva');
    var s = P.solicitud;
    s.elegirTipo('PRB');
    Check('RS5 MOD: PRB exige RCA en la solicitud (regla sin cambio)', [true, true],
      [s.rcaObligatorio(), s.faltantes().indexOf('rca') >= 0]);
    s.elegirTipo('MAP');
    Check('RS5 ... y otro tipo no', false, s.faltantes().indexOf('rca') >= 0);

    P.fijarRol(null);
    Check('RS6 perder el rol con la solicitud abierta vuelve a Iniciativas', ['panel-iniciativas'], vistaVisible(mod));
    var A = adm.ventana.IniciativasPagina;
    A.fijarRol('MOD');
    Check('RS6 ADM -> MOD conserva Nueva solicitud abierta', ['panel-nueva'], vistaVisible(adm));

    var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
    Check('RS7 Solicitar visible con autorizado (ADM o MOD): data-solo-admin', true,
      /<button type="button" class="btn ini-cta" id="btnSolicitar" data-solo-admin hidden>/.test(html));
    Check('RS7 Crear sigue solo ADM: data-solo-adm', true,
      /id="btnCrearAdmin" data-solo-adm hidden[\s>]/.test(html));
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
