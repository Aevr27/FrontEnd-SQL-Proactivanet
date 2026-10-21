// tools/tests/BarraLateralSmoke.js - prueba de humo de la BARRA LATERAL.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca.
//
// Fija el contrato del armazon de navegacion: la barra lateral es la UNICA
// navegacion global entre modulos, y cada entrada tiene que cuadrar con las
// otras piezas -el registro MODULOS (o GRUPOS, para Observabilidad y Calidad
// de información, con su selector .subnav) de dashboard.js y el contenedor
// #tab-<nombre> del marcado-. Cuando entre otro modulo, esta prueba avisa si
// se olvido una.
//
// Se lee el ARCHIVO REAL, no una copia: dashboard.js no se puede cargar aqui
// (toca document, Chart y compania al evaluarse) y dashboard.html no se puede
// montar sin navegador, asi que se comprueba sobre el texto publicado.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\BarraLateralSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var html = fs.readFileSync(path.join(raiz, 'dashboard.html'), 'utf8');
var js = fs.readFileSync(path.join(raiz, 'dashboard.js'), 'utf8');

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

// --- las entradas de la barra -------------------------------------------
var botones = todas(html, /<button[^>]*class="mnav[^"]*"[^>]*>/g).map(function (m) { return m[0]; });
var nombres = botones.map(function (b) { return (b.match(/data-tab="([^"]+)"/) || [])[1]; });

// Ocho entradas: QA y QARE van juntas en "Calidad de información" y
// Observabilidad (tablero) y Orquestación en "Observabilidad".
comprobar('la barra trae las ocho entradas', nombres.length, 8);
comprobar('la barra, en orden', nombres.join(','),
  'sla,backlog,experiencia,efectividad,calidad,analisis,observabilidad,call');
comprobar('rotulos exactos de los grupos',
  [/data-tab="observabilidad"[^>]*title="Observabilidad"/.test(html),
   /data-tab="calidad"[^>]*title="Calidad de información"/.test(html),
   /<span class="mnav-txt">Observabilidad<\/span>/.test(html),
   /<span class="mnav-txt">Calidad de información<\/span>/.test(html)].join(), 'true,true,true,true');
['qa', 'qare', 'orquestacion', 'tablero'].forEach(function (n) {
  comprobar('"' + n + '" ya no tiene entrada propia en la barra', nombres.indexOf(n), -1);
});
comprobar('ninguna entrada se quedo sin data-tab', nombres.filter(Boolean).length, nombres.length);

// --- una sola entrada marcada como la actual -----------------------------
// El resto los pone y los quita activarTab(); en el marcado solo puede nacer
// uno, el de arranque.
var conActual = botones.filter(function (b) { return /aria-current="page"/.test(b); });
comprobar('solo una entrada nace con aria-current', conActual.length, 1);
comprobar('la entrada inicial es SLA', (conActual[0] || '').indexOf('data-tab="sla"') !== -1, true);
comprobar('la entrada inicial tambien nace con .active', /class="mnav active"/.test(conActual[0] || ''), true);

// --- cada entrada se puede identificar plegada ---------------------------
botones.forEach(function (b, i) {
  comprobar('la entrada "' + nombres[i] + '" tiene title', /title="[^"]+"/.test(b), true);
});

// --- las piezas cuadran: barra <-> MODULOS/GRUPOS <-> selector <-> contenedor
var bloque = (js.match(/const MODULOS = \{[\s\S]*?\n\};/) || [''])[0];
comprobar('se encontro el registro MODULOS', bloque !== '', true);
var claves = todas(bloque, /^\s{2}([a-z]+):/gm).map(function (m) { return m[1]; });
var bloqueGrupos = (js.match(/const GRUPOS = (\{[\s\S]*?\n\});/) || [])[1];
comprobar('se encontro el registro GRUPOS', !!bloqueGrupos, true);
var GRUPOS = new Function('return ' + bloqueGrupos + ';')();

// Selectores internos: un <nav class="subnav"> por grupo, con un boton por
// modulo del grupo, en el mismo orden que GRUPOS.
var subnavs = {};
todas(html, /<nav class="subnav" data-grupo="([^"]+)"[^>]*>([\s\S]*?)<\/nav>/g).forEach(function (m) {
  comprobar('el selector "' + m[1] + '" nace oculto', /^<nav[^>]*\shidden>/.test(m[0]), true);
  subnavs[m[1]] = todas(m[2], /<button class="subnav-btn" id="snav-([a-z]+)" data-tab="([a-z]+)"/g)
    .map(function (b) {
      comprobar('id y data-tab del boton "' + b[2] + '" casan', b[1], b[2]);
      return b[2];
    });
});
comprobar('un selector por grupo', Object.keys(subnavs).sort().join(), Object.keys(GRUPOS).sort().join());
Object.keys(GRUPOS).forEach(function (g) {
  comprobar('selector "' + g + '" = GRUPOS.' + g, (subnavs[g] || []).join(), GRUPOS[g].join());
});
comprobar('Observabilidad: botones con su rotulo',
  /data-tab="orquestacion"[^>]*>Orquestación<\/button>[\s\S]*?data-tab="tablero"[^>]*>Observabilidad<\/button>/.test(html), true);
comprobar('Calidad de información: botones con su rotulo',
  /data-tab="qa"[^>]*>QA<\/button>[\s\S]*?data-tab="qare"[^>]*>QARE<\/button>/.test(html), true);

nombres.forEach(function (n) {
  var esGrupo = Object.prototype.hasOwnProperty.call(GRUPOS, n);
  comprobar('"' + n + '" esta en MODULOS o en GRUPOS (no en los dos)',
    (claves.indexOf(n) !== -1) !== esGrupo, true);
  (esGrupo ? GRUPOS[n] : [n]).forEach(function (m) {
    comprobar('"' + m + '" tiene contenedor #tab-' + m,
      html.indexOf('id="tab-' + m + '"') !== -1, true);
  });
});
// Ningun modulo se queda sin camino: entrada propia o boton de su grupo
// (con el grupo en la barra), y ninguno en dos sitios a la vez.
claves.forEach(function (n) {
  var caminos = (nombres.indexOf(n) !== -1 ? 1 : 0) + Object.keys(GRUPOS).filter(function (g) {
    return nombres.indexOf(g) !== -1 && GRUPOS[g].indexOf(n) !== -1 && (subnavs[g] || []).indexOf(n) !== -1;
  }).length;
  comprobar('el modulo "' + n + '" se alcanza desde la barra por un solo camino', caminos, 1);
});
// El contenedor de un modulo agrupado lo rotula su boton del selector.
Object.keys(GRUPOS).forEach(function (g) {
  GRUPOS[g].forEach(function (m) {
    comprobar('#tab-' + m + ' lo rotula #snav-' + m,
      new RegExp('id="tab-' + m + '"[^>]*aria-labelledby="snav-' + m + '"').test(html), true);
  });
});

// --- la navegacion vieja no quedo duplicada ------------------------------
// Dos navegaciones vivas a la vez significan dos estados activos que se
// contradicen. La de arriba (.maintabs/.mtab) tiene que haber DESAPARECIDO
// del marcado del tablero.
comprobar('no queda .maintabs en dashboard.html', /class="maintabs/.test(html), false);
comprobar('no queda ningun .mtab en dashboard.html', /class="mtab/.test(html), false);

// Los .mtab que quedan en dashboard.js son del documento de DENTRO del iframe
// (assets/Tablero_Experiencia.html, que es otra pagina con su propia nav).
// Ninguno puede consultar el documento anfitrion.
todas(js, /^.*\.mtab.*$/gm).forEach(function (m) {
  var linea = m[0].trim();
  comprobar('.mtab solo se busca dentro del iframe: ' + linea.slice(0, 48),
    /doc\.querySelector/.test(linea) || linea.indexOf('//') === 0 || linea.indexOf('*') === 0, true);
});

// --- la barra sigue entrando por activarTab() ----------------------------
comprobar('el clic de la barra llama a activarTab',
  /querySelectorAll\('\.mnav\[data-tab\]'\)[\s\S]{0,200}activarTab\(btn\.dataset\.tab\)/.test(js), true);
comprobar('el clic del selector de grupo llama a activarTab',
  /querySelectorAll\('\.subnav-btn\[data-tab\]'\)[\s\S]{0,200}activarTab\(btn\.dataset\.tab\)/.test(js), true);

// --- Administracion es un enlace, no una pestaña -------------------------
// Sin data-tab y fuera del selector del clic: no pasa por activarTab (que
// la mandaria a SLA antes de navegar). Nace oculta (SesionAdmin).
var enlaceAdmin = (html.match(/<li data-solo-admin hidden>\s*<a class="mnav"[^>]*>/) || [''])[0];
comprobar('Administracion: enlace oculto a admin/iniciativas.html',
  /href="admin\/iniciativas\.html"/.test(enlaceAdmin), true);
comprobar('Administracion: sin data-tab', /data-tab/.test(enlaceAdmin), false);
comprobar('activarTab sigue marcando la entrada activa',
  /function activarTab[\s\S]{0,1500}querySelectorAll\('\.mnav'\)/.test(js), true);

// --- la copia de admin/iniciativas.html sigue al tablero ------------------
// Es marcado copiado (pagina estatica): se habia quedado sin Efectividad ni
// Analisis de servicios. Mismas secciones, mismo orden, mismo title, cada
// una como enlace a ../dashboard.html#<data-tab> (sin data-tab: ahi no hay
// activarTab). Administracion sigue oculta (data-solo-admin) y es la unica
// marcada como actual.
var admin = fs.readFileSync(path.join(raiz, 'admin', 'iniciativas.html'), 'utf8')
  .replace(/<!--[\s\S]*?-->/g, '');
var navAdmin = (admin.match(/<aside class="lateral" id="lateral">[\s\S]*?<\/aside>/) || [''])[0];
var enlaces = todas(navAdmin, /<a class="mnav[^"]*"[^>]*>/g).map(function (m) { return m[0]; });
var deTablero = enlaces.filter(function (a) { return /href="\.\.\/dashboard\.html#/.test(a); });
comprobar('admin: las secciones del tablero, en el mismo orden',
  deTablero.map(function (a) { return a.match(/#([^"]+)"/)[1]; }).join(','), nombres.join(','));
comprobar('admin: mismo title que en el tablero',
  deTablero.map(function (a) { return (a.match(/title="([^"]+)"/) || [])[1]; }).join('|'),
  botones.map(function (b) { return (b.match(/title="([^"]+)"/) || [])[1]; }).join('|'));
comprobar('admin: Efectividad y Analisis de servicios presentes', [
  /href="\.\.\/dashboard\.html#efectividad"/.test(navAdmin), /href="\.\.\/dashboard\.html#analisis"/.test(navAdmin)].join(),
  'true,true');
comprobar('admin: ninguna entrada con data-tab', /data-tab/.test(navAdmin), false);
comprobar('admin: solo una mas (Administracion), oculta hasta SesionAdmin',
  enlaces.length - deTablero.length + '|' +
  /<li data-solo-admin hidden>\s*<a class="mnav active" href="iniciativas\.html" aria-current="page"/.test(navAdmin), '1|true');
comprobar('admin: solo Administracion nace como actual',
  enlaces.filter(function (a) { return /aria-current="page"|mnav active/.test(a); }).length, 1);
comprobar('admin: data-solo-admin solo en Administracion',
  (navAdmin.match(/data-solo-admin/g) || []).length, 1);

// --- plegar es solo una clase, no un segundo cargador --------------------
// Si plegarLateral() tocara `listo`, `montando` o init(), cambiar el ancho
// podria remontar un modulo. Solo puede pintar y remedir.
var plegar = (js.match(/function plegarLateral\(cerrar\) \{[\s\S]*?\n\}/) || [''])[0];
comprobar('se encontro plegarLateral()', plegar !== '', true);
comprobar('plegar no inicializa modulos', /\.init\(/.test(plegar), false);
comprobar('plegar no toca el estado de montaje',
  /listo\.(add|delete)|montando\./.test(plegar), false);
comprobar('plegar solo mueve la clase del armazon',
  /classList\.toggle\('lateral-cerrada'/.test(plegar), true);

console.log('');
if (fallos) {
  console.log(fallos + ' caso(s) FALLARON');
  process.exit(1);
}
console.log('TODO PASA');
