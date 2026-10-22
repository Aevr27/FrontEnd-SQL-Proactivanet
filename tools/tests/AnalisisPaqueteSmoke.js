// tools/tests/AnalisisPaqueteSmoke.js - revisa un paquete de la pestaña
// "Analisis de servicios" (Paquete_Analisis_de_servicios_*.zip, ya descomprimido)
// antes de mandarlo a instalar. El paquete se arma fuera de este repositorio
// (paquetes/armar_paquete_analisis.py, en el repo de la base); esto solo lo lee.
//
// Lo que espera sale de este repositorio, no del paquete:
//   - 1_base_SSMS/: los scripts de la tabla de analisis/INSTALAR.md, ni uno de mas
//     ni de menos; cada servicio con las reglas que dice esa tabla; claves y
//     nombres sin repetir; el 78 nombra a todos los servicios del paquete; los
//     que tambien estan en sql/ de este repositorio, iguales.
//   - 2_sitio_archivos_nuevos/: los archivos de "Archivos nuevos" de
//     analisis/INSTALAR.md, iguales a los de este repositorio (si no, el
//     paquete lleva una copia vieja).
//   - LEEME_PRIMERO.md nombra cada script.
//   - Nada de Web.config, config*.json, *.mock.json, bin/, salidas de SSMS
//     (*.rpt) ni archivos de mas de 2 MB.
//
// NO corre SQL ni toca ninguna base. Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\AnalisisPaqueteSmoke.js <carpeta del paquete descomprimido>
//
// PASS/FAIL por caso; sale 0 si todo paso.
'use strict';
var fs = require('fs');
var path = require('path');
var Sql = require(path.join(__dirname, 'AnalisisSqlServicio.js'));

var raiz = path.join(__dirname, '..', '..');
var paquete = process.argv[2];
if (!paquete || !fs.existsSync(paquete) || !fs.statSync(paquete).isDirectory()) {
  console.log('Uso: node tools\\tests\\AnalisisPaqueteSmoke.js <carpeta del paquete descomprimido>');
  process.exit(2);
}

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}
function Ok(caso, cond, detalle) { Check(caso, true, !!cond + (cond ? '' : '  (' + detalle + ')')); }

function archivos(dir, base) {
  var out = [];
  fs.readdirSync(dir).forEach(function (n) {
    var p = path.join(dir, n), rel = (base ? base + '/' : '') + n;
    if (fs.statSync(p).isDirectory()) out = out.concat(archivos(p, rel));
    else out.push(rel);
  });
  return out;
}
// Igual salvo los saltos de linea y el BOM.
function texto(p) { return fs.readFileSync(p, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n'); }
function iguales(a, b) {
  var ba = fs.readFileSync(a), bb = fs.readFileSync(b);
  return ba.equals(bb) || texto(a) === texto(b);
}
function lista(v) { return v.length ? v.join(', ') : '(ninguno)'; }

/* ------------------------------------------- lo esperado: analisis/INSTALAR.md */
var instalar = texto(path.join(raiz, 'analisis', 'INSTALAR.md'));
var filas = [], re = /^\| `(\d\d_[a-z0-9_]+\.sql)` \| ([^\n]*)\|$/gm, m;
while ((m = re.exec(instalar))) {
  var r = /sus (\d+) reglas/.exec(m[2]);
  filas.push({ archivo: m[1], reglas: r ? +r[1] : null });
}
var bloqueSitio = /### Archivos nuevos[\s\S]*?```\n([\s\S]*?)```/.exec(instalar);
var sitio = bloqueSitio ? bloqueSitio[1].split('\n').map(function (l) { return l.trim(); }).filter(Boolean) : [];
Ok('INSTALAR.md: trae la tabla de scripts', filas.length > 0, 'sin tabla');
Ok('INSTALAR.md: trae la lista de archivos del sitio', sitio.length > 0, 'sin lista');

/* --------------------------------------------------------------- el paquete */
var todos = archivos(paquete, '');
var base = todos.filter(function (f) { return /^1_base_SSMS\//.test(f); }).map(function (f) { return f.slice('1_base_SSMS/'.length); });
var enSitio = todos.filter(function (f) { return /^2_sitio_archivos_nuevos\//.test(f); }).map(function (f) { return f.slice('2_sitio_archivos_nuevos/'.length); });
var otros = todos.filter(function (f) { return !/^(1_base_SSMS|2_sitio_archivos_nuevos)\//.test(f) && f !== 'LEEME_PRIMERO.md'; });

var esperados = filas.map(function (f) { return f.archivo; });
Check('base: no falta ningun script de INSTALAR.md', '(ninguno)', lista(esperados.filter(function (f) { return base.indexOf(f) < 0; })));
Check('base: no sobra ningun archivo', '(ninguno)', lista(base.filter(function (f) { return esperados.indexOf(f) < 0; })));
Check('sitio: no falta ningun archivo de INSTALAR.md', '(ninguno)', lista(sitio.filter(function (f) { return enSitio.indexOf(f) < 0; })));
// Lo que no esta en la lista (analisis/vendor/LEEME.md) pasa si tambien esta en el repositorio.
Check('sitio: no trae archivos que no estan en el repositorio', '(ninguno)', lista(enSitio.filter(function (f) { return sitio.indexOf(f) < 0 && !fs.existsSync(path.join(raiz, f)); })));
Check('nada fuera de las dos carpetas y LEEME_PRIMERO.md', '(ninguno)', lista(otros));
Check('nada que no se reparte', '(ninguno)', lista(todos.filter(function (f) {
  return /(^|\/)(Web\.config|config[^/]*\.json|[^/]*\.mock\.json|[^/]*\.rpt)$/i.test(f) || /(^|\/)bin\//i.test(f);
})));
Check('ningun archivo de mas de 2 MB', '(ninguno)', lista(todos.filter(function (f) { return fs.statSync(path.join(paquete, f)).size > 2 * 1024 * 1024; })));

/* ---------------------------------------------------- los scripts de servicio */
var servicios = [];
filas.forEach(function (f) {
  var p = path.join(paquete, '1_base_SSMS', f.archivo);
  if (!fs.existsSync(p) || f.reglas == null) return;
  try {
    var s = Sql.leerScriptServicio(Sql.leerArchivo(p));
    s.archivo = f.archivo;
    servicios.push(s);
    Check(f.archivo + ': ' + f.reglas + ' reglas, como dice INSTALAR.md', f.reglas, s.reglas.length);
    Check(f.archivo + ': ninguna regla sin leer', s.tuplasRegla, s.reglas.length);
    Check(f.archivo + ': la cabecera dice las mismas reglas', s.reglas.length, s.cabecera && s.cabecera.reglas);
    Check(f.archivo + ': ids sin repetir', s.reglas.length, new Set(s.reglas.map(function (r) { return r.id; })).size);
    Ok(f.archivo + ': frases en JSON', s.reglas.every(function (r) { try { return JSON.parse(r.frasesTexto).length > 0; } catch (e) { return false; } }), 'alguna no');
  } catch (e) {
    Check(f.archivo + ': se lee como script de servicio', 'si', e.message);
  }
});
function repetidos(v) { return v.filter(function (x, i) { return v.indexOf(x) !== i; }); }
Check('claves de servicio sin repetir', '(ninguno)', lista(repetidos(servicios.map(function (s) { return s.clave; }))));
Check('nombres de servicio sin repetir', '(ninguno)', lista(repetidos(servicios.map(function (s) { return s.nombre; }))));

var p78 = path.join(paquete, '1_base_SSMS', '78_analisis_secciones.sql');
if (fs.existsSync(p78)) {
  var s78 = Sql.leerSecciones78(Sql.leerArchivo(p78)), k78 = s78.map(function (x) { return x.clave; });
  Check('78: todas las tuplas leidas', s78.tuplas, s78.length);
  Check('78: sin claves repetidas', '(ninguno)', lista(repetidos(k78)));
  Check('78: nombra a todos los servicios del paquete', '(ninguno)', lista(servicios.map(function (s) { return s.clave; }).filter(function (k) { return k78.indexOf(k) < 0; })));
  Check('78: no nombra servicios que el paquete no trae', '(ninguno)', lista(k78.filter(function (k) { return !servicios.some(function (s) { return s.clave === k; }); })));
  // Lo que deja el 78 y lo que deja el script de cada servicio, iguales.
  Check('78: mismas secciones que cada script', '(ninguno)', lista(servicios.filter(function (s) {
    var x = s78.filter(function (y) { return y.clave === s.clave; })[0];
    return x && String(x.secciones) !== String(s.secciones);
  }).map(function (s) { return s.clave; })));
}

/* ---------------------------------------------- iguales a este repositorio */
base.forEach(function (f) {
  var enRepo = path.join(raiz, 'sql', f);
  if (fs.existsSync(enRepo)) Ok('base: ' + f + ' igual a sql/' + f, iguales(path.join(paquete, '1_base_SSMS', f), enRepo), 'distinto');
});
enSitio.forEach(function (f) {
  var enRepo = path.join(raiz, f);
  Ok('sitio: ' + f + ' igual al repositorio', fs.existsSync(enRepo) && iguales(path.join(paquete, '2_sitio_archivos_nuevos', f), enRepo),
     fs.existsSync(enRepo) ? 'distinto: copia vieja o cambio sin subir' : 'no esta en el repositorio');
});

/* -------------------------------------------------------- LEEME_PRIMERO.md */
var leeme = path.join(paquete, 'LEEME_PRIMERO.md');
Ok('LEEME_PRIMERO.md esta', fs.existsSync(leeme), 'falta');
if (fs.existsSync(leeme)) {
  var tl = texto(leeme);
  Check('LEEME_PRIMERO.md nombra cada script', '(ninguno)', lista(base.filter(function (f) { return tl.indexOf(f) < 0; })));
}

console.log(fallos ? '\n' + fallos + ' caso(s) fallaron' : '\nTodo paso');
process.exit(fallos ? 1 : 0);
