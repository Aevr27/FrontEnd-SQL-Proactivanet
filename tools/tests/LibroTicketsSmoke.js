// tools/tests/LibroTicketsSmoke.js - prueba de humo del libro de Excel que
// descarga el tablero de Experiencia.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca. Ejecuta el bloque LibroTickets REAL, recortado
// de experiencia/experiencia.js entre sus dos marcadores, con el mismo vendor
// de SheetJS que usa la pagina (experiencia/vendor/xlsx.mini.min.js), y abre
// el .xlsx resultante para comprobar dos cosas distintas:
//
//   1) que el CONTENIDO es el mismo que se exportaba antes -las mismas filas,
//      las mismas columnas y los mismos valores, como texto-, y
//   2) que el FORMATO llego al archivo: estilos, panel congelado, autofiltro,
//      anchos y ajuste de texto, que la build comunitaria de SheetJS no
//      escribe por su cuenta.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\LibroTicketsSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var XLSX = require(path.join(raiz, 'experiencia', 'vendor', 'xlsx.mini.min.js'));

// El bloque real, tal cual esta en el archivo del tablero. Si alguien mueve
// o borra los marcadores, la prueba falla aqui y no en silencio.
function cargarLibroTickets() {
  var fuente = fs.readFileSync(path.join(raiz, 'experiencia', 'experiencia.js'), 'utf8');
  var ini = fuente.indexOf('/* === LIBRO XLSX (inicio) ===');
  var fin = fuente.indexOf('/* === LIBRO XLSX (fin) === */');
  if (ini < 0 || fin < 0) throw new Error('no se encontraron los marcadores LIBRO XLSX en experiencia/experiencia.js');
  var bloque = fuente.slice(ini, fin);
  return (new Function(bloque + '\nreturn LibroTickets;'))();
}

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

var LibroTickets = cargarLibroTickets();

// Las mismas diez columnas que exporta descargarTickets(), en su orden.
var ENCABEZADOS = ['Fecha de registro', 'Código', 'Grupo', 'Estado', 'Título',
  'Descripción', 'Categoría', 'Solución para el usuario', 'Tipo', 'Tipo relación'];

var FILAS = [
  ['2026-09-01 08:12', 'INC-000101', 'Mesa de Servicio', 'Cerrado', 'Caja no imprime',
   'Descripción larga '.repeat(12), 'S-Punto de Venta', 'Se reinicio el servicio', 'Incidencia', 'Problem'],
  ['2026-09-02 09:30', 'INC-000102', 'Infraestructura', 'Pendiente', 'VPN intermitente',
   'Otra descripción', 'S-Redes', '', 'Incidencia', ''],
  ['2026-09-03 10:45', 'INC-000103', 'Aplicaciones', 'Reabierto', 'Error 500 en portal',
   '', 'S-Portal', 'Pendiente de analisis', 'Petición', 'Mejora'],
  ['2026-09-04 11:00', 'REQ-000104', 'Retail', 'Estado desconocido', 'Alta de usuario',
   '', 'S-Retail', '', 'Petición', ''],
];

var META = [
  ['Periodo', 'Sep (0-30d)'],
  ['Director', 'Yuri Vladimir Lopez Martinez'],
  ['Product Owner', 'Todos'],
  ['Manager', 'Todos'],
  ['Service Owner', 'Todos'],
  ['Total de tickets', '4'],
  ['Exportado', '15/09/2026, 10:00:00'],
];

var bytes = LibroTickets.construir(XLSX, {
  hoja: 'Tickets',
  titulo: 'Tickets — Dashboard Export',
  subtitulo: 'Tablero de Experiencia',
  meta: META,
  etiquetaTotal: 'Total de tickets',
  encabezados: ENCABEZADOS,
  filas: FILAS,
  anchos: [18, 15, 24, 16, 42, 60, 26, 45, 14, 16],
  largas: [4, 5, 7],
  colEstado: 3,
});

// ------------------------------------------------------------------ contenido
var libro = XLSX.read(Buffer.from(bytes), { type: 'buffer' });
Check('la hoja se sigue llamando Tickets', 'Tickets', libro.SheetNames.join(','));

var hoja = libro.Sheets.Tickets;
var matriz = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '' });

// La tabla empieza en la fila cuyo primer valor es el primer encabezado.
var iEnc = -1;
for (var i = 0; i < matriz.length; i++) {
  if (matriz[i][0] === ENCABEZADOS[0]) { iEnc = i; break; }
}
Check('la tabla tiene su fila de encabezados', 'true', iEnc > 0);
Check('los encabezados son los mismos, en el mismo orden',
  ENCABEZADOS.join('|'), (matriz[iEnc] || []).join('|'));
Check('se exportan todas las filas y ninguna de mas',
  String(FILAS.length), String(matriz.length - iEnc - 1));

var iguales = true;
for (var f = 0; f < FILAS.length; f++) {
  var salida = matriz[iEnc + 1 + f] || [];
  for (var c = 0; c < ENCABEZADOS.length; c++) {
    if (String(salida[c] === undefined ? '' : salida[c]) !== FILAS[f][c]) iguales = false;
  }
}
Check('cada valor llega intacto, sin reinterpretar', 'true', iguales);
Check('el codigo sigue siendo texto, no numero', 's', hoja[XLSX.utils.encode_cell({ r: iEnc + 1, c: 1 })].t);

// -------------------------------------------------------------------- cabecera
Check('el titulo del reporte esta arriba', 'Tickets — Dashboard Export', matriz[0][0]);
var etiquetas = [];
for (var m = 3; m < iEnc - 1; m++) if (matriz[m] && matriz[m][0]) etiquetas.push(matriz[m][0]);
Check('la cabecera lleva el contexto del tablero',
  META.map(function (x) { return x[0]; }).join('|'), etiquetas.join('|'));
Check('y sus valores, sin inventar ninguno',
  META.map(function (x) { return x[1]; }).join('|'),
  META.map(function (x, k) { return matriz[3 + k][1]; }).join('|'));

// --------------------------------------------------------------------- formato
var CFB = XLSX.CFB.read(Buffer.from(bytes), { type: 'buffer' });
function texto(ruta) {
  var e = XLSX.CFB.find(CFB, ruta);
  if (!e) return '';
  var s = '';
  for (var i = 0; i < e.content.length; i++) s += String.fromCharCode(e.content[i]);
  return s;
}
var estilos = texto('/xl/styles.xml');
var hojaXml = texto('/xl/worksheets/sheet1.xml');

Check('el libro lleva hoja de estilos con rellenos', 'true', /<fills count="[1-9]/.test(estilos));
Check('el verde del tablero es el del encabezado de la tabla', 'true', estilos.indexOf('FF166534') >= 0);
Check('hay filas alternas', 'true', estilos.indexOf('FFF3F6F4') >= 0);
Check('hay ajuste de texto para los campos largos', 'true', estilos.indexOf('wrapText="1"') >= 0);
Check('el encabezado de la tabla queda congelado', 'true',
  hojaXml.indexOf('<pane ySplit="' + (iEnc + 1) + '" topLeftCell="A' + (iEnc + 2) + '"') >= 0
  && hojaXml.indexOf('state="frozen"') >= 0);
Check('el autofiltro va sobre la tabla, no sobre la cabecera', 'true',
  hojaXml.indexOf('<autoFilter ref="A' + (iEnc + 1) + ':J' + (matriz.length) + '"') >= 0);
Check('las columnas llevan ancho propio', 'true', /<col min="1"[^>]*customWidth="1"/.test(hojaXml));
Check('las celdas apuntan a un estilo', 'true', / s="[0-9]+"/.test(hojaXml));

// No se combina NADA dentro de la tabla: romperia ordenar y filtrar.
var merges = hojaXml.match(/<mergeCell ref="([^"]+)"/g) || [];
var dentro = merges.filter(function (t) {
  var fila = parseInt(t.match(/[A-Z]+(\d+)/)[1], 10);
  return fila > iEnc;
});
Check('ninguna combinacion cae dentro de la tabla', '0', String(dentro.length));

// Semaforo del Estado: solo sobre valores conocidos, y sin tocar el valor.
var E = LibroTickets.ESTILOS;
Check('Cerrado lleva enfasis verde', String(E.ESTADO_VERDE), String(LibroTickets.estiloEstado('Cerrado')));
Check('Pendiente lleva enfasis ambar', String(E.ESTADO_AMBAR), String(LibroTickets.estiloEstado('Pendiente')));
Check('Reabierto lleva enfasis rojo', String(E.ESTADO_ROJO), String(LibroTickets.estiloEstado('Reabierto')));
Check('un estado desconocido no se pinta', 'null', String(LibroTickets.estiloEstado('Estado desconocido')));
Check('el valor del estado no cambia', 'Reabierto', matriz[iEnc + 3][3]);

console.log(fallos ? ('FALLOS: ' + fallos) : 'TODO PASA');
process.exit(fallos ? 1 : 0);
