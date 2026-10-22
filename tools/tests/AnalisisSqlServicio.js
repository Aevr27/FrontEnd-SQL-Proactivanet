// tools/tests/AnalisisSqlServicio.js - lee, sin base, lo que da de alta un
// script de servicio de la pestaña "Analisis de servicios" (48 en adelante,
// el formato de Motor.scriptServicio) y el 78 de las secciones.
//
// NO forma parte del sitio ni corre SQL: solo lee el texto del archivo. Lo usan
// AnalisisAbastoConciliacionesSmoke.js y AnalisisPaqueteSmoke.js.
'use strict';
var fs = require('fs');

// Texto del archivo sin BOM y con saltos \n.
function leerArchivo(ruta) {
  return fs.readFileSync(ruta, 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
}
// N'...' de T-SQL: la comilla va doble.
var LIT = "N'((?:[^']|'')*)'";
function lit(s) { return s.replace(/''/g, "'"); }

// {clave, nombre, descripcion, desdeSugerido, motivosEquipo, secciones, criterios, reglas,
//  cabecera: {criterios, reglas, frases}} o lanza si el archivo no tiene el formato.
function leerScriptServicio(sql) {
  var m = new RegExp("USING \\(SELECT Servicio = '([a-z0-9_-]+)',\\s*Nombre = " + LIT +
                     ",\\s*Descripcion = (?:" + LIT + "|NULL),\\s*DesdeSugerido = (?:CONVERT\\(DATE, '([0-9-]+)', 23\\)|NULL),\\s*MotivosEquipo = " + LIT +
                     "(?:,\\s*Secciones = (?:" + LIT + "|CONVERT\\(NVARCHAR\\(MAX\\), NULL\\)))?\\) AS o").exec(sql);
  if (!m) throw new Error('no se encontro el MERGE de dbo.AnalisisServicio');
  var s = {
    clave: m[1], nombre: lit(m[2]), descripcion: m[3] == null ? null : lit(m[3]), desdeSugerido: m[4] || null,
    motivosEquipo: JSON.parse(lit(m[5])), secciones: m[6] == null ? null : lit(m[6]),
    escribeSecciones: /Secciones = o\.Secciones/.test(sql), criterios: [], reglas: [], cabecera: null
  };
  var reC = new RegExp("\\(\\s*'" + s.clave + "',\\s*(\\d+),\\s*'(Ruta|RutaFuera|Grupo|Titulo)',\\s*" + LIT + "\\)", 'g'), x;
  while ((x = reC.exec(sql))) s.criterios.push({ orden: +x[1], clave: x[2], valor: lit(x[3]) });
  var reR = new RegExp("\\(\\s*'" + s.clave + "',\\s*(\\d+),\\s*'([A-Za-z0-9_]+)',\\s*" + LIT + ",\\s*'(D|S|DS)',\\s*" + LIT + "\\)", 'g');
  while ((x = reR.exec(sql))) s.reglas.push({ orden: +x[1], id: x[2], motivo: lit(x[3]), campo: x[4], frasesTexto: lit(x[5]) });
  var c = /(\d+) criterio\(s\), (\d+) regla\(s\), (\d+) frase\(s\)/.exec(sql);
  if (c) s.cabecera = { criterios: +c[1], reglas: +c[2], frases: +c[3] };
  // Las demas tuplas de la tabla: si hay mas de las que se leyeron, el formato cambio.
  s.tuplasRegla = (sql.split('INSERT INTO dbo.AnalisisRegla')[1] || '').split(/\n\s*\('/).length - 1;
  s.tuplasCriterio = ((sql.split('INSERT INTO dbo.AnalisisServicioCriterio')[1] || '').split('DELETE FROM')[0].match(/\n\s*\('/g) || []).length;
  return s;
}

// El 78: [{clave, secciones (texto o null)}].
function leerSecciones78(sql) {
  var bloque = /JOIN \(VALUES([\s\S]*?)\) AS v \(Servicio, Secciones\)/.exec(sql);
  if (!bloque) throw new Error('no se encontro la lista VALUES del 78');
  var out = [], re = new RegExp("\\('([a-z0-9_-]+)', (?:" + LIT + "|NULL)\\)", 'g'), x;
  while ((x = re.exec(bloque[1]))) out.push({ clave: x[1], secciones: x[2] == null ? null : lit(x[2]) });
  out.tuplas = (bloque[1].match(/\n\s*\('/g) || []).length;
  return out;
}

module.exports = { leerArchivo: leerArchivo, leerScriptServicio: leerScriptServicio, leerSecciones78: leerSecciones78 };
