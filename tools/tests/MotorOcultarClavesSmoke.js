// tools/tests/MotorOcultarClavesSmoke.js - prueba de humo de ocultarClaves en
// analisis/motor.js: las contrasenas que el Service Desk escribe en claro en el
// titulo, la descripcion o la solucion no salen en el Detalle ni en su Excel.
//
// NO forma parte del sitio: vive fuera de analisis/, asi que ni IIS ni el
// navegador la cargan nunca. Usa el motor.js REAL (por require, como dice su
// cabecera) y el mismo vendor de ExcelJS que usa la pagina.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\MotorOcultarClavesSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var Motor = require(path.join(raiz, 'analisis', 'motor.js'));
var ExcelJS = require(path.join(raiz, 'analisis', 'vendor', 'exceljs.min.js'));

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}
function Ok(caso, cond, detalle) { Check(caso, true, !!cond + (cond ? '' : '  (' + detalle + ')')); }

var oc = Motor.ocultarClaves;

/* ---------------------------------------------------------------- etiquetas */
Check('espanol: contraseña nueva', 'Tu contraseña nueva: **** gracias', oc('Tu contraseña nueva: Abc123! gracias'));
Check('espanol sin tilde: contrasena', 'contrasena: ****', oc('contrasena: Abc123!'));
Check('espanol: clave temporal sin dos puntos', 'Clave temporal **** vigente 24 h', oc('Clave temporal Sap#2026 vigente 24 h'));
Check('ingles: temporary password', 'temporary password: ****', oc('temporary password: Abc123!'));
Check('pwd con =', 'usuario=jperez pwd=****', oc('usuario=jperez pwd=Qw3rty'));
Check('passwd', 'passwd: ****', oc('passwd: hunter2'));
Check('secret de Azure', 'client secret: ****', oc('client secret: 8Q~abcDEF.ghi'));
Check('secreto (antes se tapaba "o:" y salia el valor)', 'secreto: ****', oc('secreto: Abc123'));
Check('plural: passwords', 'passwords: ****', oc('passwords: Abc123'));
Check('plural: contraseñas', 'contraseñas: ****', oc('contraseñas: Abc123'));

/* ------------------------------------------------ mayusculas y puntuacion */
Check('MAYUSCULAS', 'CONTRASEÑA: ****', oc('CONTRASEÑA: Abc123!'));
Check('Mixtas', 'PassWord:****', oc('PassWord:Abc123!'));
Check('sin espacio tras =', 'PWD =****', oc('PWD =Abc123'));
Check('etiqueta al inicio y valor con coma final', 'Contraseña: **** y listo', oc('Contraseña: Abc123!, y listo'));
Check('entre parentesis', '(password: ****', oc('(password: Abc123)'));

/* ------------------------------------------------------- varios valores */
Check('dos valores en un texto',
      'Usuario jperez contraseña: **** y clave temporal: **** para SAP',
      oc('Usuario jperez contraseña: Abc123! y clave temporal: Xy9-77 para SAP'));
Check('etiqueta repetida no tapa la segunda etiqueta', 'contraseña contraseña: ****', oc('contraseña contraseña: Abc123'));

/* ------------------------------------------------ texto normal sin cambio */
[
  'Se restablece la contraseña del usuario en el portal.',
  'Solicita cambio de contraseña de red',
  'Olvido su contraseña.',
  'La clave del sitio es la de siempre',
  'Secretaria de la tienda reporta falla',
  'secretaria: Maria Lopez',              // antes se tapaba ("secret" dentro de "secretaria")
  'Secretario(a) de finanzas',
  'autoclave: 5 piezas',                   // "clave" dentro de otra palabra
  'Ticket INC-2026-123456 del 2026-10-12 10:30, tienda 5549, CEDIS Salinas Victoria',
  'Estado: Resuelta; Prioridad: Alta; SLA: 8 h',
  ''
].forEach(function (s) { Check('sin cambio: "' + s + '"', s, oc(s)); });
Check('null queda null', 'null', oc(null));
Check('undefined queda undefined', 'undefined', oc(undefined));

/* ---------------------------------------- el Detalle y el Excel (ruta real) */
var SECRETOS = ['TituloPw#1', 'DescPw#2', 'SolPw#3', 'Otro$Pw4'];
var COLS = ['CodigoTicket', 'Origen', 'Tipo', 'Categoria', 'Estado', 'Subestado', 'Prioridad', 'SLA', 'TipoRelacion', 'Grupo',
            'TipoSitio', 'SitioNumero', 'Tienda', 'FechaRegistro', 'FechaEstimadaResolucion', 'FechaFirmaSolucion',
            'FechaFirmaCierre', 'FechaUltimaModificacion', 'IntentosSolucion', 'ReasignacionesGrupo',
            'Titulo', 'Descripcion', 'SolucionUsuario'];
function ticket(n, titulo, desc, sol) {
  return { CodigoTicket: 'INC-2026-00000' + n, Origen: 'Portal', Tipo: 'Incidencia', Categoria: '/Red/Usuarios', Estado: 'Cerrada',
           Subestado: 'Cerrada', Prioridad: 'Media', SLA: 'Estandar', TipoRelacion: '', Grupo: 'Mesa',
           TipoSitio: 'Tienda', SitioNumero: '5549', Tienda: '5549 Monterrey',
           FechaRegistro: '2026-10-0' + n + ' 09:00:00', FechaEstimadaResolucion: '2026-10-0' + n + ' 17:00:00',
           FechaFirmaSolucion: '2026-10-0' + n + ' 12:00:00', FechaFirmaCierre: '2026-10-0' + n + ' 13:00:00',
           FechaUltimaModificacion: '2026-10-0' + n + ' 13:00:00', IntentosSolucion: '1', ReasignacionesGrupo: '0',
           Titulo: titulo, Descripcion: desc, SolucionUsuario: sol };
}
var filas = [
  ticket(1, 'Desbloqueo, password: ' + SECRETOS[0], 'Usuario bloqueado en red', 'Se desbloquea la cuenta'),
  ticket(2, 'Restablecer acceso', 'El usuario indica su clave temporal: ' + SECRETOS[1] + ' no funciona', 'Se restablece'),
  ticket(3, 'Restablecer acceso', 'Olvido su contraseña.', 'La nueva contraseña: ' + SECRETOS[2] + ' y pwd=' + SECRETOS[3]),
  ticket(4, 'Falla de impresora', 'No imprime tickets de venta', 'Se cambio el toner')
];
var datos = Motor.preparar({ bloques: [{ tipo: 'tickets', cols: COLS, filas: filas, descartadas: [] }], avisos: [], corte: null });
Ok('preparar arma los tickets', datos && datos.tickets && datos.tickets.length === 4, JSON.stringify(datos && datos.error));

var reglas = [{ clave: 'R01', motivo: 'Contraseña', campo: 'DS', frases: ['contrasena', 'password', 'clave temporal'] }];
var res = Motor.analizar(datos, { nombre: 'Prueba', reglas: reglas }, { conTextos: true });
var cols = res.detalle.columnas.map(function (c) { return c.n; });
var iT = cols.indexOf('Titulo'), iD = cols.indexOf('Descripcion'), iS = cols.indexOf('SolucionUsuario'), iM = cols.indexOf('Motivo');
Ok('Detalle trae las tres columnas de texto', iT >= 0 && iD >= 0 && iS >= 0, cols.join(','));

var porCodigo = {};
res.detalle.filas.forEach(function (f) { porCodigo[f[0]] = f; });
Check('Detalle Titulo tapado', 'Desbloqueo, password: ****', porCodigo['INC-2026-000001'][iT]);
Check('Detalle Descripcion tapada', 'El usuario indica su clave temporal: **** no funciona', porCodigo['INC-2026-000002'][iD]);
Check('Detalle SolucionUsuario tapada (dos valores)', 'La nueva contraseña: **** y pwd=****', porCodigo['INC-2026-000003'][iS]);
Check('Detalle texto normal intacto', 'No imprime tickets de venta', porCodigo['INC-2026-000004'][iD]);

// Clasificar lee el texto original: tapar no cambia el motivo.
Check('motivo sin cambio (ticket 1)', 'Contraseña', porCodigo['INC-2026-000001'][iM]);
Check('motivo sin cambio (ticket 2)', 'Contraseña', porCodigo['INC-2026-000002'][iM]);
Check('motivo sin cambio (ticket 4)', Motor.SIN_CLASIFICAR, porCodigo['INC-2026-000004'][iM]);
Check('codigo y fecha intactos', 'INC-2026-000003|' + Date.UTC(2026, 9, 3, 9),
      porCodigo['INC-2026-000003'][0] + '|' + porCodigo['INC-2026-000003'][cols.indexOf('FechaRegistro')]);

function sinSecretos(valores) {
  return SECRETOS.filter(function (s) { return valores.some(function (v) { return v != null && String(v).indexOf(s) >= 0; }); });
}
var todoDetalle = [].concat.apply([], res.detalle.filas);
Check('ningun secreto en el Detalle', '', sinSecretos(todoDetalle).join(','));
Check('ningun secreto en el resto de las hojas', '',
      sinSecretos([JSON.stringify(res.hojas), JSON.stringify(res.hallazgos), JSON.stringify(res.graficas)]).join(','));

// Sin conTextos el Detalle no lleva textos (la pagina de claude.ai): no cambia.
var resSin = Motor.analizar(datos, { nombre: 'Prueba', reglas: reglas }, {});
Check('sin conTextos no hay columna Titulo', -1, resSin.detalle.columnas.map(function (c) { return c.n; }).indexOf('Titulo'));

(async function () {
  var wb = Motor.armarLibro(res, ExcelJS);
  var buf = await wb.xlsx.writeBuffer();
  var leido = new ExcelJS.Workbook();
  await leido.xlsx.load(buf);
  var celdas = [];
  leido.eachSheet(function (ws) { ws.eachRow(function (r) { r.eachCell(function (c) { celdas.push(c.value); }); }); });
  Ok('el Excel trae celdas', celdas.length > 100, celdas.length);
  Check('ningun secreto en el Excel (todas las hojas)', '', sinSecretos(celdas).join(','));
  // Respaldo: tambien en el .xlsx crudo (sharedStrings) por si una celda no se leyo.
  var JSZip = null; try { JSZip = require('jszip'); } catch (e) { /* opcional */ }
  if (JSZip) {
    var z = await JSZip.loadAsync(buf), xml = '';
    for (var k of Object.keys(z.files)) if (/\.xml$/.test(k)) xml += await z.files[k].async('string');
    Check('ningun secreto en el .xlsx crudo', '', sinSecretos([xml]).join(','));
  }
  var det = leido.getWorksheet('Detalle'), enc = det.getRow(1).values;
  var cS = enc.indexOf('SolucionUsuario'), fila3 = null;
  det.eachRow(function (r) { if (r.getCell(1).value === 'INC-2026-000003') fila3 = r; });
  Check('Excel Detalle SolucionUsuario tapada', 'La nueva contraseña: **** y pwd=****', fila3 && fila3.getCell(cS).value);

  console.log(fallos ? '\n' + fallos + ' caso(s) fallaron' : '\nTodo paso');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
