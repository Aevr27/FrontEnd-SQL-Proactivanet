// Prueba en node de COMO SE MUESTRA quien envio una solicitud (2026-11-05):
// admin/solicitudes-cambio.js (cola de ADM y Mis solicitudes de cambio) y
// admin/solicitudes-nuevas.js (registro de ADM y Mis solicitudes) usan
// solicitante_mostrar del servidor (App_Code/NombreSolicitante.cs:
// UsuariosAdmin.NombreSolicitante -> nombre verificado -> correo -> cuenta)
// y siguen mostrando la cuenta debajo cuando lo mostrado no es la cuenta.
// Sin solicitante_mostrar (servidor viejo), como antes.
// Correr: node tools/tests/NombreSolicitanteSmoke.js
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var raiz = path.join(__dirname, '..', '..');
var caja = { Promise: Promise, FormData: FormData, encodeURIComponent: encodeURIComponent, Date: Date, isNaN: isNaN, console: console };
caja.window = caja; caja.globalThis = caja;
vm.runInNewContext(fs.readFileSync(path.join(raiz, 'assets', 'js', 'escape.js'), 'utf8'), caja);
vm.runInNewContext(fs.readFileSync(path.join(raiz, 'admin', 'solicitudes-cambio.js'), 'utf8'), caja);
vm.runInNewContext(fs.readFileSync(path.join(raiz, 'admin', 'solicitudes-nuevas.js'), 'utf8'), caja);
var C = caja.SolicitudesCambioCola, N = caja.SolicitudesNuevas;

var fallos = 0;
function Check(titulo, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  if (e !== o) fallos++;
  console.log((e === o ? 'PASS  ' : 'FAIL  ') + titulo + (e === o ? '' : '  esperado=' + e + '  obtenido=' + o));
}
function Cambio(o) {
  var d = { id: 7, folio: 'PRB 2026-000001', tipo: 'OTROS', estado: 'PENDIENTE', motivo: 'm', solicitado_por: 'SORIANA\\miguel.lopez',
    rol_solicitante: 'MOD', fecha_solicitud_utc: '2026-11-05T10:00:00Z', categorias_detalle: [], eventos: [], actual: {} };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}
function Ini(o) {
  var d = { numero: 3, numero_texto: '#0000003', estado: 'ENVIADA', tipo: 'ADO', titulo: 'T', solicitante_cuenta: 'SORIANA\\miguel.lopez',
    solicitante_nombre: null, solicitante_correo: 'miguel@soriana.com', fecha_utc: '2026-11-05T10:00:00Z', eventos: [] };
  Object.keys(o || {}).forEach(function (k) { d[k] = o[k]; });
  return d;
}
function celdaSolicito(html) { var m = /<td>([^<]*(?:<span class="chip[^<]*<\/span>)?(?:<span class="ini-sub">[^<]*<\/span>)?)<\/td><td>[0-9]{2}\//.exec(html); return m ? m[1] : null; }

// ---- Cambios ----
var adm = C.htmlLista([Cambio({ solicitante_mostrar: 'Miguel Lopez Ruiz', solicitante_mostrar_fuente: 'NOMBRE_ADMIN' })], false, null);
Check('C1 cola de ADM: el nombre capturado, con la cuenta debajo', [true, true, false],
  [/<td>Miguel Lopez Ruiz <span class="chip ini-chip">MOD<\/span><span class="ini-sub">SORIANA\\miguel\.lopez<\/span><\/td>/.test(adm),
   /Miguel Lopez Ruiz/.test(adm), /<td>SORIANA\\miguel\.lopez <span/.test(adm)]);
var correo = C.htmlLista([Cambio({ solicitante_mostrar: 'miguel@soriana.com', solicitante_mostrar_fuente: 'CORREO' })], false, null);
Check('C2 sin nombre: el correo, con la cuenta debajo', true, /<td>miguel@soriana\.com <span class="chip ini-chip">MOD<\/span><span class="ini-sub">SORIANA\\miguel\.lopez<\/span>/.test(correo));
var cuenta = C.htmlLista([Cambio({ solicitante_mostrar: 'SORIANA\\miguel.lopez', solicitante_mostrar_fuente: 'CUENTA' })], false, null);
Check('C3 sin nombre ni correo: la cuenta, sin repetirla debajo', [true, false],
  [/<td>SORIANA\\miguel\.lopez <span class="chip ini-chip">MOD<\/span><\/td>/.test(cuenta), /ini-sub">SORIANA\\miguel\.lopez/.test(cuenta)]);
var viejo = C.htmlLista([Cambio({ solicitante_nombre: 'De CatPersona' })], false, null);
Check('C4 servidor sin solicitante_mostrar: como antes (CatPersona y la cuenta debajo)', true,
  /<td>De CatPersona <span class="chip ini-chip">MOD<\/span><span class="ini-sub">SORIANA\\miguel\.lopez<\/span>/.test(viejo));
var det = C.htmlDetalle(Cambio({ solicitante_mostrar: 'Miguel Lopez Ruiz' }), {}, {});
Check('C5 detalle de ADM: "la envio <nombre> (<cuenta>, <rol>)"', true, /la envió Miguel Lopez Ruiz \(SORIANA\\miguel\.lopez, MOD\)/.test(det));
var detMio = C.htmlDetalle(Cambio({ solicitante_mostrar: 'Miguel Lopez Ruiz' }), null, null, true);
Check('C6 Mis (lectura): el mismo nombre', true, /la envió Miguel Lopez Ruiz \(SORIANA\\miguel\.lopez, MOD\)/.test(detMio));
var x = C.htmlLista([Cambio({ solicitante_mostrar: '<b>x</b>' })], false, null);
Check('C7 escapa lo mostrado', [true, false], [/&lt;b&gt;x&lt;\/b&gt;/.test(x), /<b>x<\/b>/.test(x)]);

// ---- Iniciativas ----
var l = N.htmlLista([Ini({ solicitante_mostrar: 'Miguel Lopez Ruiz', solicitante_mostrar_fuente: 'NOMBRE_ADMIN' })]);
Check('N1 registro: nombre capturado, con el correo debajo', true, /<td>Miguel Lopez Ruiz<span class="ini-sub">miguel@soriana\.com<\/span><\/td>/.test(l));
var lc = N.htmlLista([Ini({ solicitante_mostrar: 'miguel@soriana.com', solicitante_mostrar_fuente: 'CORREO' })]);
Check('N2 sin nombre: el correo, sin repetirlo debajo', [true, false],
  [/<td>miguel@soriana\.com<\/td>/.test(lc), /ini-sub">miguel@soriana\.com/.test(lc)]);
var lk = N.htmlLista([Ini({ solicitante_correo: null, solicitante_mostrar: 'SORIANA\\miguel.lopez', solicitante_mostrar_fuente: 'CUENTA' })]);
Check('N3 sin nombre ni correo: la cuenta', true, /<td>SORIANA\\miguel\.lopez<\/td>/.test(lk));
var lv = N.htmlLista([Ini({ solicitante_nombre: 'Guardado' })]);
Check('N4 servidor sin solicitante_mostrar: como antes (nombre guardado + correo)', true, /<td>Guardado<span class="ini-sub">miguel@soriana\.com<\/span><\/td>/.test(lv));
var dn = N.htmlDetalle(Ini({ solicitante_mostrar: 'Miguel Lopez Ruiz' }), true);
Check('N5 detalle: nombre, correo y la cuenta debajo', true,
  /Solicitó<\/th><td>Miguel Lopez Ruiz<span class="ini-sub">miguel@soriana\.com<\/span><span class="ini-sub">SORIANA\\miguel\.lopez<\/span>/.test(dn));
var dk = N.htmlDetalle(Ini({ solicitante_correo: null, solicitante_mostrar: 'SORIANA\\miguel.lopez' }), false, 'ms');
Check('N6 detalle con la cuenta como lo mostrado: no la repite', false, /ini-sub">SORIANA\\miguel\.lopez/.test(dk));

console.log(fallos === 0 ? 'OK: todo paso' : 'FALLOS: ' + fallos);
process.exit(fallos === 0 ? 0 : 1);
