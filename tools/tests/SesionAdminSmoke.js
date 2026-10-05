// tools/tests/SesionAdminSmoke.js - prueba de humo de SesionAdmin
// (assets/js/sesion-admin.js): la entrada Administracion y el saludo.
//
// Es solo UX; lo que se fija aqui es que nunca muestre de mas: cualquier
// respuesta que no sea { autorizado: true } deja todo oculto, y el saludo
// solo sale con un nombre que haya dado el servidor.
//
//   node tools\tests\SesionAdminSmoke.js   # sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var codigo = fs.readFileSync(path.join(__dirname, '..', '..', 'assets', 'js', 'sesion-admin.js'), 'utf8');
var caja = { Promise: Promise };
caja.globalThis = caja;
vm.runInNewContext(codigo, caja);
var SesionAdmin = caja.SesionAdmin;

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
    return sel === '[data-solo-admin]' ? items : sel === '[data-solo-adm]' ? adm : [];
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
]).then(function (r) {
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
  console.log(fallos === 0 ? 'OK: todo paso' : 'FALLOS: ' + fallos);
  process.exit(fallos === 0 ? 0 : 1);
});
