// tools/tests/RcaCorreoSmoke.js - reglas de la pagina en admin/rca-correo.js
// (seccion "Correo RCA" de admin/admin.html).
//
// Son reglas de CORTESIA: las que cuentan estan en el servidor
// (App_Code/RcaCorreoPrueba.cs, tools/tests/RcaCorreoPruebaSmoke.cs). Aqui
// se fija que la pagina dice lo mismo antes de mandar: extension, tamano,
// nombre del adjunto, asunto y forma de los correos. Ademas revisa el HTML:
// un solo archivo (sin multiple), el boton empieza deshabilitado y la
// pagina no pinta datos del servidor con innerHTML.
//
// Como correrla (desde la raiz del repositorio):
//   node tools\tests\RcaCorreoSmoke.js
'use strict';
var fs = require('fs');
var path = require('path');
var raiz = path.join(__dirname, '..', '..');
var R = require(path.join(raiz, 'admin', 'rca-correo.js'));

var fallos = 0, pasados = 0;
function check(caso, esperado, obtenido) {
  var ok = JSON.stringify(esperado) === JSON.stringify(obtenido);
  if (ok) { pasados++; } else { fallos++; }
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + JSON.stringify(esperado) + '  obtenido=' + JSON.stringify(obtenido)));
}

var cfg = { maxBytes: 3145728, extensiones: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'], prefijoAsunto: 'PRUEBA RCA - ', nombreAdjunto: 'Prueba_RCA' };
function archivo(nombre, size) { return { name: nombre, size: size }; }

check('J1 extension simple', 'pdf', R.extension('rca.pdf'));
check('J2 extension con ruta de Windows', 'docx', R.extension('C:\\x\\RCA v2.docx'));
check('J3 sin extension', null, R.extension('rca'));
check('J4 punto inicial no es extension', null, R.extension('.pdf'));
check('J5 archivo pdf valido', '', R.motivoArchivo(archivo('rca.pdf', 100), cfg));
check('J6 mayusculas permitidas', '', R.motivoArchivo(archivo('RCA.PDF', 100), cfg));
check('J7 sin archivo', 'Selecciona un documento.', R.motivoArchivo(null, cfg));
check('J8 vacio', 'El documento esta vacio.', R.motivoArchivo(archivo('rca.pdf', 0), cfg));
check('J9 demasiado grande', 'El documento pasa del maximo de 3 MB.', R.motivoArchivo(archivo('rca.pdf', 3145729), cfg));
check('J10 exe no permitido', true, R.motivoArchivo(archivo('rca.exe', 10), cfg).indexOf('no permitido') > 0);
check('J11 nombre del adjunto conserva la extension', 'Prueba_RCA.PDF', R.nombreAdjunto(archivo('Informe.PDF', 1), cfg));
check('J12 asunto', 'PRUEBA RCA - Caida WMS', R.asunto('  Caida WMS  ', cfg));
check('J13 asunto sin titulo', '—', R.asunto('  ', cfg));
check('J14 correo valido', '', R.correoValido('yo@outlook.com', true));
check('J15 Para obligatorio', 'Es obligatorio.', R.correoValido('', true));
check('J16 CC opcional', '', R.correoValido('  ', false));
check('J17 una sola direccion', 'Solo una direccion de correo.', R.correoValido('a@b.com;c@d.com', true));
check('J18 forma invalida', 'No es un correo valido.', R.correoValido('no-es-correo', true));

var html = fs.readFileSync(path.join(raiz, 'admin', 'admin.html'), 'utf8');
var input = /<input type="file" id="rcaArchivo"[^>]*>/.exec(html);
check('J19 input de archivo sin multiple', false, !input || / multiple/.test(input[0]));
check('J20 boton Probar empieza deshabilitado', true, /id="rcaEnviar" disabled/.test(html));
check('J21 seccion y campos con los nombres pedidos', true,
  />Correo RCA</.test(html) && />CC RCA/.test(html) && />Probar correo RCA</.test(html) && />Título de prueba</.test(html));
check('J22 admin.html carga rca-correo.js', true, /<script src="rca-correo.js"><\/script>/.test(html));

var js = fs.readFileSync(path.join(raiz, 'admin', 'rca-correo.js'), 'utf8');
check('J23 la pagina no usa innerHTML (todo con textContent)', false, /innerHTML/.test(js));
check('J24 un envio a la vez en la pagina', true, /if \(enviando \|\| motivoNoListo\(\)\) \{ return; \}/.test(js));

// Un id repetido hace que getElementById devuelva el primero (paso con
// rcaTitulo: el <h2> de la seccion le ganaba al campo del titulo).
var ids = (html.match(/ id="[^"]+"/g) || []).map(function (s) { return s.slice(5, -1); });
check('J25 admin.html sin ids repetidos', [], ids.filter(function (id, i) { return ids.indexOf(id) !== i; }));

console.log('\n' + pasados + ' pasaron, ' + fallos + ' fallaron');
process.exit(fallos ? 1 : 0);
