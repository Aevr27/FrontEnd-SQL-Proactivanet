// tools/tests/SesionAdminSmoke.js - prueba de humo de SesionAdmin
// (assets/js/sesion-admin.js): la entrada Iniciativas, Solicitar y el saludo.
//
// Es solo UX; lo que se fija aqui es que nunca muestre de mas: la entrada
// Iniciativas (data-solo-registro) sale con registro: true o autorizado:
// true (2026-10-28: el registro es de toda cuenta autenticada); Solicitar
// solo con solicitante: true confirmado; el saludo solo con un nombre que
// haya dado el servidor. Una respuesta que el servidor no pudo confirmar
// (verificacion: "incompleta" o 5xx) no muestra Solicitar (I*), con un solo
// reintento automatico; y vigilar() vuelve a preguntar una vez por cada 403
// de Admin con la pagina abierta (V*).
//
//   node tools\tests\SesionAdminSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var codigo = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'js', 'sesion-admin.js'), 'utf8');
var caja = { Promise: Promise, setTimeout: setTimeout };
caja.globalThis = caja;
vm.runInNewContext(codigo, caja);
var SesionAdmin = caja.SesionAdmin;
// El unico reintento automatico, sin esperar de verdad.
SesionAdmin.ESPERA_REINTENTO = 0;

var fallos = 0;
function comprobar(titulo, obtenido, esperado) {
  var ok = obtenido === esperado;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + titulo + (ok ? '' : '  esperado=' + esperado + '  obtenido=' + obtenido));
}

function respuesta(status, cuerpo) {
  return function (url) {
    respuesta.ultima = url;
    return Promise.resolve({ ok: status >= 200 && status < 300, status: status,
      json: function () { return typeof cuerpo === 'function' ? cuerpo() : Promise.resolve(cuerpo); } });
  };
}

function documento() {
  var items = [{ hidden: true }, { hidden: true }];
  // data-solo-adm: "+ Solicitar una iniciativa" (oculto en el marcado).
  var adm = [{ hidden: true }];
  return { items: items, adm: adm, querySelectorAll: function (sel) {
    return sel === '[data-solo-registro]' ? items : sel === '[data-solo-adm]' ? adm : [];
  } };
}

function caso(titulo, pedir, saludo) {
  var doc = documento();
  var el = saludo ? { textContent: '', hidden: true } : null;
  return new SesionAdmin('../', pedir).aplicar(doc, el).then(function (s) {
    return { s: s, doc: doc, el: el, titulo: titulo };
  });
}

Promise.all([
  caso('autorizado con nombre', respuesta(200, { autorizado: true, nombre: ' Andres Vera ' }), true),
  caso('autorizado sin nombre', respuesta(200, { autorizado: true }), true),
  caso('no autorizado', respuesta(200, { autorizado: false, nombre: 'X' }), true),
  caso('autorizado como texto', respuesta(200, { autorizado: 'true' }), false),
  caso('500', respuesta(500, { error: 'x' }), true),
  caso('red caida', function () { return Promise.reject(new Error('sin red')); }, true),
  caso('json roto', respuesta(200, function () { return Promise.reject(new Error('json')); }), false),
  caso('ADM', respuesta(200, { autorizado: true, rol: 'ADM' }), false),
  caso('MOD', respuesta(200, { autorizado: true, rol: 'MOD' }), false),
  caso('rol raro', respuesta(200, { autorizado: true, rol: 'adm ' }), false),
  caso('ADM sin autorizado', respuesta(200, { autorizado: false, rol: 'ADM' }), false),
  caso('registro sin rol', respuesta(200, { autorizado: false, solicitante: false, registro: true, nombre: 'X' }), true),
  caso('registro como texto', respuesta(200, { autorizado: false, registro: 'true' }), false),
]).then(function (r) {
  comprobar('registro sin rol: entrada Iniciativas visible, sin saludo ni boton de crear',
    r[11].doc.items[0].hidden + '|' + r[11].el.hidden + '|' + r[11].doc.adm[0].hidden + '|' + r[11].s.registro, 'false|true|true|true');
  comprobar('registro "true" (texto): no cuenta', r[12].doc.items[0].hidden, true);
  comprobar('ADM: rol y boton de crear visible', r[7].s.rol + '|' + r[7].doc.adm[0].hidden, 'ADM|false');
  comprobar('MOD: entra a Admin, boton de crear oculto', r[8].doc.items[0].hidden + '|' + r[8].s.rol + '|' + r[8].doc.adm[0].hidden, 'false|MOD|true');
  comprobar('rol que no es exacto: sin rol, oculto', r[9].s.rol + '|' + r[9].doc.adm[0].hidden, 'null|true');
  comprobar('ADM sin autorizado: sin rol, oculto', r[10].s.rol + '|' + r[10].doc.adm[0].hidden, 'null|true');
  comprobar('sin rol (respuesta vieja): boton oculto', r[1].doc.adm[0].hidden, true);
  comprobar('500: boton oculto', r[4].doc.adm[0].hidden, true);
  comprobar('red caida: boton oculto', r[5].doc.adm[0].hidden, true);
  comprobar('autorizado: muestra entrada', r[0].doc.items[0].hidden, false);
  comprobar('autorizado: muestra todas', r[0].doc.items[1].hidden, false);
  comprobar('autorizado: saludo', r[0].el.textContent, 'Bienvenido, Andres Vera');
  comprobar('autorizado: saludo visible', r[0].el.hidden, false);
  comprobar('sin nombre: entrada visible', r[1].doc.items[0].hidden, false);
  comprobar('sin nombre: sin saludo', r[1].el.hidden, true);
  comprobar('sin nombre: texto vacio', r[1].el.textContent, '');
  comprobar('no autorizado: entrada oculta', r[2].doc.items[0].hidden, true);
  comprobar('no autorizado: sin saludo', r[2].el.hidden, true);
  comprobar('"true" texto no autoriza', r[3].doc.items[0].hidden, true);
  comprobar('500: oculta', r[4].doc.items[0].hidden, true);
  comprobar('500: sin saludo', r[4].el.hidden, true);
  comprobar('red caida: oculta', r[5].doc.items[0].hidden, true);
  comprobar('json roto: oculta', r[6].doc.items[0].hidden, true);

  var urls = [];
  var pedir = function (u) { urls.push(u); return Promise.resolve({ ok: true, json: function () { return Promise.resolve({}); } }); };
  return Promise.all([
    new SesionAdmin('', pedir).consultar(),
    new SesionAdmin('../', pedir).consultar({ persona: true }),
  ]).then(function () {
    comprobar('url tablero', urls[0], 'handlers/admin_sesion.ashx');
    comprobar('url admin con persona', urls[1], '../handlers/admin_sesion.ashx?persona=1');
  });
}).then(function () {
  // Correo de la cabecera: solo el que mande el servidor, con forma de correo,
  // y solo autorizado. Nunca se arma uno.
  function conCorreo(cuerpo) {
    var doc = documento(), saludo = { textContent: '', hidden: true }, correo = { textContent: 'x', hidden: false };
    var urls = [];
    var pedir = function (u) { urls.push(u); return respuesta(200, cuerpo)(u); };
    return new SesionAdmin('../', pedir).aplicar(doc, saludo, correo).then(function (s) { return { s: s, el: correo, url: urls[0] }; });
  }
  return Promise.all([
    conCorreo({ autorizado: true, rol: 'MOD', correo: ' andresvr@soriana.com ' }),
    conCorreo({ autorizado: true, rol: 'ADM' }),
    conCorreo({ autorizado: false, correo: 'andresvr@soriana.com' }),
    conCorreo({ autorizado: true, correo: '<b>x</b>@a.com' }),
    conCorreo({ autorizado: true, correo: 'sin arroba' }),
    conCorreo({ autorizado: true, correo: 42 }),
    (function () {
      var url = null;
      return new SesionAdmin('../', function (u) { url = u; return respuesta(200, { autorizado: true })(u); })
        .aplicar(documento(), null, { textContent: '', hidden: true }).then(function () { return url; });
    })(),
  ]).then(function (r) {
    comprobar('correo: se pinta el del servidor, sin espacios', r[0].el.textContent + '|' + r[0].el.hidden, 'andresvr@soriana.com|false');
    comprobar('correo: pide ?persona=1', r[0].url, '../handlers/admin_sesion.ashx?persona=1');
    comprobar('correo: sin correo del servidor, oculto y vacio (no se arma)', r[1].el.textContent + '|' + r[1].el.hidden, '|true');
    comprobar('correo: no autorizado, oculto', r[2].el.hidden + '|' + r[2].s.correo, 'true|null');
    comprobar('correo: con marcado, no se acepta', r[3].el.hidden, true);
    comprobar('correo: sin forma de correo, no se acepta', r[4].el.hidden, true);
    comprobar('correo: no texto, no se acepta', r[5].el.hidden, true);
    comprobar('correo sin saludo tambien pide ?persona=1', r[6], '../handlers/admin_sesion.ashx?persona=1');
  });
}).then(function () {
  // La entrada Iniciativas (data-solo-registro) para toda cuenta con
  // registro: true (o autorizado); "Solicitar una iniciativa"
  // (data-solo-solicitud) para todo solicitante: true (ADM, MOD, PO/SO), con
  // rol o sin el; Crear (data-solo-adm) solo ADM; el saludo para autorizado
  // o solicitante.
  // Columnas: solicitante | Iniciativas oculta | Crear oculto | saludo oculto | Solicitar oculto.
  function conSolicitante(cuerpo) {
    var reg = [{ hidden: true }], adm = [{ hidden: true }], pedir = [{ hidden: true }];
    var doc = { querySelectorAll: function (sel) {
      return sel === '[data-solo-registro]' ? reg : sel === '[data-solo-adm]' ? adm : sel === '[data-solo-solicitud]' ? pedir : [];
    } };
    var saludo = { textContent: '', hidden: true };
    return new SesionAdmin('../', respuesta(200, cuerpo)).aplicar(doc, saludo).then(function (s) {
      return [s.solicitante, reg[0].hidden, adm[0].hidden, saludo.hidden, pedir[0].hidden].join('|');
    });
  }
  return Promise.all([
    conSolicitante({ autorizado: false, solicitante: true, registro: true, nombre: 'Juan Perez' }),
    conSolicitante({ autorizado: false, solicitante: false, registro: true, nombre: 'Juan Perez' }),
    conSolicitante({ autorizado: false, solicitante: 'true', registro: true, nombre: 'Juan Perez' }),
    conSolicitante({ autorizado: false, nombre: 'Juan Perez' }),
    conSolicitante({ autorizado: true, rol: 'MOD', solicitante: true, registro: true }),
    conSolicitante({ autorizado: true, rol: 'ADM', solicitante: true, registro: true }),
    conSolicitante({ autorizado: true, rol: 'MOD', solicitante: false, nombre: 'Mod Uno' }),
    conSolicitante({ autorizado: true, rol: 'ADM' }),
  ]).then(function (r) {
    comprobar('PO/SO sin rol: Iniciativas, Solicitar y saludo; sin Crear', r[0], 'true|false|true|false|false');
    comprobar('cuenta comun: solo Iniciativas (el registro), sin saludo ni Solicitar', r[1], 'false|false|true|true|true');
    comprobar('solicitante "true" (texto): no cuenta', r[2], 'false|false|true|true|true');
    comprobar('respuesta sin registro ni solicitante: todo oculto', r[3], 'false|true|true|true|true');
    comprobar('MOD: Iniciativas y Solicitar, sin Crear', r[4], 'true|false|true|true|false');
    comprobar('ADM: Iniciativas, Crear y Solicitar', r[5], 'true|false|false|true|false');
    comprobar('autorizado sin registro (respuesta vieja): Iniciativas igual; sin Solicitar si no lo dice', r[6], 'false|false|true|false|true');
    comprobar('autorizado sin solicitante: no es solicitante implicito (sin Solicitar)', r[7], 'false|false|false|true|true');
  });
}).then(function () {
  // INCIERTO: admin_sesion contesto pero una consulta fallo
  // (verificacion: "incompleta") o respondio 5xx. No es "sin rol" ni "sin
  // PO/SO": sin Solicitar (aunque diga solicitante: true); el registro sigue
  // (no depende de eso); Reintentar solo si tampoco hay entrada Iniciativas.
  // Un reintento automatico, y nada mas.
  function secuencia(cuerpos) {
    var n = 0;
    var pedir = function () {
      var c = cuerpos[Math.min(n, cuerpos.length - 1)]; n++;
      return c === 'red' ? Promise.reject(new Error('sin red')) : respuesta(c[0], c[1])();
    };
    var el = {};
    ['[data-solo-registro]', '[data-solo-adm]', '[data-solo-solicitud]', '[data-sesion-incierta]'].forEach(function (k) { el[k] = [{ hidden: true }]; });
    var doc = { querySelectorAll: function (sel) { return el[sel] || []; } };
    var sesion = new SesionAdmin('', pedir);
    function visibles() {
      return ['[data-solo-registro]', '[data-solo-solicitud]', '[data-sesion-incierta]']
        .map(function (k) { return el[k][0].hidden ? '-' : k.replace(/\[data-(solo-)?|\]/g, ''); }).join(',');
    }
    return sesion.aplicar(doc).then(function (s) {
      return { s: s, n: function () { return n; }, sesion: sesion, doc: doc, vis: visibles() };
    });
  }
  var INC = { autorizado: false, solicitante: true, registro: true, verificacion: 'incompleta' };
  return Promise.all([
    secuencia([[200, INC], [200, INC]]),
    secuencia([[200, INC], [200, { autorizado: true, rol: 'ADM', solicitante: true, registro: true }]]),
    secuencia([[500, { error: 'x' }], [500, { error: 'x' }]]),
    secuencia(['red']),
    secuencia([[200, { autorizado: true, rol: 'MOD', solicitante: true, registro: true, verificacion: 'incompleta' }]]),
    secuencia([[200, { autorizado: false, solicitante: true, registro: true }]]),
    secuencia([[200, { autorizado: false, solicitante: false, registro: true }]]),
    secuencia([[200, { autorizado: false, solicitante: true, registro: true, verificacion: 'otra' }]]),
    secuencia([[200, { autorizado: false, solicitante: false, registro: false }]]),
  ]).then(function (r) {
    comprobar('I1 incierto 2 veces: Iniciativas (registro) sin Solicitar ni Reintentar, 2 preguntas', r[0].vis + '|' + r[0].n() + '|' + r[0].s.incierto, 'registro,-,-|2|true');
    comprobar('I2 incierto y luego ADM confirmado: Iniciativas y Solicitar', r[1].vis + '|' + r[1].n() + '|' + r[1].s.incierto, 'registro,solicitud,-|2|false');
    comprobar('I3 500 dos veces: incierto, sin entrada: Reintentar, 2 preguntas', r[2].vis + '|' + r[2].n(), '-,-,sesion-incierta|2');
    comprobar('I4 sin red (MOCK_DATA, sin servidor): todo oculto, en silencio, sin reintento', r[3].vis + '|' + r[3].n() + '|' + r[3].s.incierto, '-,-,-|1|false');
    comprobar('I5 MOD confirmado con una consulta que falla: Iniciativas y Solicitar, sin Reintentar, 1 pregunta', r[4].vis + '|' + r[4].n(), 'registro,solicitud,-|1');
    comprobar('I6 PO/SO confirmado: Iniciativas y Solicitar, 1 pregunta', r[5].vis + '|' + r[5].n(), 'registro,solicitud,-|1');
    comprobar('I7 cuenta comun confirmada: solo Iniciativas, sin Reintentar, 1 pregunta', r[6].vis + '|' + r[6].n(), 'registro,-,-|1');
    comprobar('I8 solo "incompleta" cuenta como incierto', r[7].s.incierto + '|' + r[7].vis, 'false|registro,solicitud,-');
    comprobar('I8b sin registro (anonimo): nada', r[8].vis + '|' + r[8].n(), '-,-,-|1');
    // Reintentar (la persona pulsa): aplicar otra vez, con su unico reintento.
    return r[0].sesion.aplicar(r[0].doc).then(function () {
      comprobar('I9 Reintentar a mano: dos preguntas mas (acotado)', r[0].n(), 4);
    });
  });
}).then(function () {
  // Dos aplicar() a la vez comparten la pregunta.
  var n = 0;
  var s = new SesionAdmin('', function () { n++; return respuesta(200, { autorizado: true, rol: 'ADM', solicitante: true })(); });
  var doc = { querySelectorAll: function () { return []; } };
  return Promise.all([s.aplicar(doc), s.aplicar(doc)]).then(function () {
    comprobar('I10 dos aplicar a la vez: una sola pregunta', n, 1);
  });
}).then(function () {
  // vigilar: un 403 de handlers/admin_* (no admin_sesion) vuelve a
  // preguntar UNA vez y pasa el estado nuevo; la respuesta sigue igual.
  comprobar('V0 esHandlerAdmin', [
    SesionAdmin.esHandlerAdmin('../handlers/admin_iniciativas_registro.ashx'),
    SesionAdmin.esHandlerAdmin('handlers/admin_correos.ashx?x=1'),
    SesionAdmin.esHandlerAdmin('../handlers/admin_sesion.ashx?persona=1'),
    SesionAdmin.esHandlerAdmin('../handlers/kpis.ashx'),
    SesionAdmin.esHandlerAdmin({ url: 'http://x/handlers/admin_iniciativas_validar.ashx' })].join(), 'true,true,false,false,true');
  var preguntas = 0, estados = [];
  caja.fetch = function (url) {
    var st = /admin_iniciativas_registro|admin_iniciativas_gestion/.test(url) ? 403 : 200;
    return Promise.resolve({ ok: st === 200, status: st, json: function () { return Promise.resolve({}); } });
  };
  var sesion = new SesionAdmin('../', function () {
    preguntas++;
    return respuesta(200, { autorizado: false, solicitante: true })();
  });
  sesion.vigilar(function (s) { estados.push(s.autorizado + '/' + s.solicitante); });
  sesion.vigilar(function () { estados.push('doble'); });   // no se envuelve dos veces
  function pausa() { return new Promise(function (ok) { setTimeout(ok, 5); }); }
  return Promise.all([
    caja.fetch('../handlers/admin_iniciativas_registro.ashx'),
    caja.fetch('../handlers/admin_iniciativas_gestion.ashx'),
    caja.fetch('../handlers/admin_iniciativas_catalogos.ashx'),
    caja.fetch('../handlers/kpis.ashx'),
  ]).then(function (rs) {
    return pausa().then(function () {
      comprobar('V1 los 403 siguen llegando al que los pidio', rs.map(function (r) { return r.status; }).join(), '403,403,200,200');
      comprobar('V2 dos 403 a la vez: UNA pregunta a admin_sesion, un aviso', preguntas + '|' + estados.join(), '1|false/true');
      return caja.fetch('../handlers/admin_iniciativas_registro.ashx');
    });
  }).then(function () {
    return pausa().then(function () {
      comprobar('V3 otro 403 despues: otra pregunta (una por 403, nunca en bucle)', preguntas + '|' + estados.length, '2|2');
      return caja.fetch('../handlers/admin_iniciativas_catalogos.ashx');
    });
  }).then(function () {
    return pausa().then(function () {
      comprobar('V4 un 200 no pregunta', preguntas, 2);
    });
  });
}).then(function () {
  console.log(fallos === 0 ? 'OK: todo paso' : 'FALLOS: ' + fallos);
  process.exit(fallos === 0 ? 0 : 1);
});
