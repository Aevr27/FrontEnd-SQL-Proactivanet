// tools/tests/NavegacionModulosSmoke.js - prueba de humo del ROUTER de pestañas.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca.
//
// Fija la regla de resolverModulo() (dashboard.js): el nombre de pestaña que
// llega del hash es texto libre, y solo valen las claves PROPIAS del registro
// MODULOS. Antes el filtro era `if (!MODULOS[nombre])`, y con un objeto plano
// eso deja pasar lo que MODULOS hereda de Object.prototype -constructor,
// __proto__, toString, valueOf...-: el nombre se daba por bueno, se apagaban
// todas las pestañas, ningun contenedor casaba con `tab-<nombre>` y se
// reventaba al llamar .init() sobre algo que no era un modulo.
//
// Tambien fija los GRUPOS (Observabilidad, Calidad de información): su nombre
// se resuelve al primer modulo del grupo, o al ultimo visto.
//
// dashboard.js no se puede cargar entero aqui -toca document, Chart y
// compania en cuanto se evalua-, asi que se extrae del ARCHIVO REAL el texto
// de resolverModulo() y se evalua suelto contra un registro de mentira. Asi la
// prueba mira el codigo que se publica, no una copia.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\NavegacionModulosSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var codigo = fs.readFileSync(path.join(__dirname, '..', '..', 'dashboard.js'), 'utf8').replace(/\r\n/g, '\n');

function cargarResolver() {
  var m = codigo.match(/function resolverModulo\(nombre\) \{[\s\S]*?\n\}/);
  if (!m) throw new Error('no encontre resolverModulo() en dashboard.js');
  // MODULOS entra como parametro: el registro de verdad se arma con los
  // tableros, que aqui no existen. GRUPOS y ultimoDeGrupo tambien, para
  // poder probar el "ultimo visto" sin activarTab().
  return new Function('MODULOS', 'GRUPOS', 'ultimoDeGrupo', m[0] + '\nreturn resolverModulo;');
}

// GRUPOS es un literal sin dependencias: se evalua el del archivo real.
var bloqueGrupos = codigo.match(/const GRUPOS = (\{[\s\S]*?\n\});/);
if (!bloqueGrupos) throw new Error('no encontre GRUPOS en dashboard.js');
var GRUPOS = new Function('return ' + bloqueGrupos[1] + ';')();

// Mismas claves que el registro real, con valores de relleno: lo que se prueba
// es la resolucion del nombre, no los tableros.
var MODULOS_FALSO = {
  sla: {}, backlog: {}, experiencia: {}, efectividad: {}, qa: {}, qare: {},
  analisis: {}, call: {}, tablero: {},
};

var ultimo = {};
var resolverModulo = cargarResolver()(MODULOS_FALSO, GRUPOS, ultimo);

var fallos = 0;
function comprobar(titulo, obtenido, esperado) {
  var ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + titulo +
    '  esperado=' + esperado + '  obtenido=' + obtenido);
}

// --- el registro falso no se quedo atras del real -------------------------
var clavesReales = (codigo.match(/const MODULOS = \{([\s\S]*?)\n\};/)[1].match(/^\s{2}([a-z]+):/gm) || [])
  .map(function (l) { return l.trim().slice(0, -1); });
comprobar('el registro falso tiene las claves del real',
  Object.keys(MODULOS_FALSO).sort().join(','), clavesReales.sort().join(','));

// --- claves heredadas de Object.prototype: NINGUNA es una pestaña ---------
comprobar('constructor no es un modulo', resolverModulo('constructor'), 'sla');
comprobar('__proto__ no es un modulo', resolverModulo('__proto__'), 'sla');
comprobar('toString no es un modulo', resolverModulo('toString'), 'sla');
comprobar('valueOf no es un modulo', resolverModulo('valueOf'), 'sla');
comprobar('hasOwnProperty no es un modulo', resolverModulo('hasOwnProperty'), 'sla');
comprobar('prototype no es un modulo', resolverModulo('prototype'), 'sla');

// --- nombres que no existen ----------------------------------------------
comprobar('nombre inventado cae en sla', resolverModulo('no-existe'), 'sla');
comprobar('cadena vacia cae en sla', resolverModulo(''), 'sla');
comprobar('undefined cae en sla', resolverModulo(undefined), 'sla');
comprobar('null cae en sla', resolverModulo(null), 'sla');

// --- los modulos de verdad se resuelven a si mismos ----------------------
// Incluye los hashes de siempre de los modulos agrupados (#tablero, #qa,
// #qare): los enlaces viejos siguen abriendo su modulo.
Object.keys(MODULOS_FALSO).forEach(function (n) {
  comprobar('modulo "' + n + '" se resuelve solo', resolverModulo(n), n);
});

// --- grupos: #observabilidad y #calidad abren un modulo del grupo ---------
comprobar('los dos grupos existen', Object.keys(GRUPOS).sort().join(','), 'calidad,observabilidad');
// Observabilidad: por ahora solo el marco, que trae su Orquestacion dentro.
comprobar('Observabilidad = el marco (tablero)', GRUPOS.observabilidad.join(','), 'tablero');
comprobar('Calidad de informacion = QA + QARE', GRUPOS.calidad.join(','), 'qa,qare');
comprobar('#observabilidad abre Observabilidad (tablero) la primera vez', resolverModulo('observabilidad'), 'tablero');
comprobar('#calidad abre QA la primera vez', resolverModulo('calidad'), 'qa');
ultimo.calidad = 'qare';
comprobar('#calidad abre el ultimo visto (QARE)', resolverModulo('calidad'), 'qare');
Object.keys(GRUPOS).forEach(function (g) {
  comprobar('el grupo "' + g + '" no pisa una clave de MODULOS',
    Object.prototype.hasOwnProperty.call(MODULOS_FALSO, g), false);
  GRUPOS[g].forEach(function (n) {
    comprobar('"' + n + '" del grupo "' + g + '" es un modulo',
      Object.prototype.hasOwnProperty.call(MODULOS_FALSO, n), true);
  });
});

// --- la caja tambien importa: el hash es sensible a mayusculas ------------
comprobar('SLA en mayusculas no es sla', resolverModulo('SLA'), 'sla');
comprobar('Backlog capitalizado cae en sla', resolverModulo('Backlog'), 'sla');
comprobar('Calidad capitalizado cae en sla', resolverModulo('Calidad'), 'sla');

console.log('');
if (fallos) {
  console.log(fallos + ' caso(s) FALLARON');
  process.exit(1);
}
console.log('TODO PASA');
