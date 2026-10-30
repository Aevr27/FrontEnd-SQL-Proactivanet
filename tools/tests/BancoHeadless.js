// tools/tests/BancoHeadless.js - banco de pruebas de pagina en un Chrome de
// verdad, para las *HeadlessSmoke.js. NO forma parte del sitio.
//
// Sirve el repositorio desde 127.0.0.1 (puerto libre) y, en memoria, una
// pagina armada por la prueba (la pagina suelta del modulo con un fetch de
// mentira y una sonda). Chrome headless la abre con --dump-dom y la sonda
// deja su resultado como JSON en <pre id="__res">. No escribe nada en disco.
//
//   var Banco = require('./BancoHeadless');
//   if (!Banco.CHROME) { console.log('SKIP ...'); process.exit(0); }
//   Banco.correr({ '/orquestacion/__banco.html': html }, ['/orquestacion/__banco.html', '...?falla=1'])
//     .then(function (resultados) { ... });   // un objeto por url, o null
//
//   Banco.pagina(rel, modulo, antes, sonda): rel (p. ej.
//   'orquestacion/orquestacion.html') con `antes` justo antes del <script>
//   `modulo` y la funcion `sonda` como IIFE al final del <body>.
//
// Chrome: CHROME=<ruta>, o el de Google / Edge en su sitio de siempre.
'use strict';
var fs = require('fs');
var path = require('path');
var http = require('http');
var cp = require('child_process');

var raiz = path.join(__dirname, '..', '..');

var CHROME = [process.env.CHROME,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium'].filter(function (r) { return r && fs.existsSync(r); })[0] || null;

var TIPOS = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };

function pagina(rel, modulo, antes, sonda) {
  var html = fs.readFileSync(path.join(raiz, rel), 'utf8');
  var etiqueta = '<script src="' + modulo + '"></script>';
  if (html.indexOf(etiqueta) < 0) throw new Error(rel + ' sin ' + etiqueta);
  return html.replace(etiqueta, antes + etiqueta)
    .replace('</body>', '<script>(' + sonda.toString() + ')();</script></body>');
}

// presupuesto: ms de tiempo virtual antes de volcar el DOM (10 s por omision).
function abrir(url, presupuesto) {
  return new Promise(function (ok) {
    cp.execFile(CHROME, ['--headless=new', '--disable-gpu', '--no-first-run', '--virtual-time-budget=' + (presupuesto || 10000), '--dump-dom', url],
      { maxBuffer: 32 * 1024 * 1024, timeout: 60000 }, function (err, salida) {
        var m = /<pre id="__res">([\s\S]*?)<\/pre>/.exec(salida || '');
        if (!m) return ok(null);
        var txt = m[1].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
        try { ok(JSON.parse(txt)); } catch (e) { ok(null); }
      });
  });
}

// paginas: { '/ruta/servida.html': html }. urls: rutas (con su ?query).
// presupuesto: opcional, ver abrir().
function correr(paginas, urls, presupuesto) {
  var servidor = http.createServer(function (req, res) {
    var ruta = decodeURIComponent(req.url.split('?')[0]);
    if (Object.prototype.hasOwnProperty.call(paginas, ruta)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end(paginas[ruta]);
    }
    var archivo = path.join(raiz, path.normalize(ruta));
    if (archivo.indexOf(raiz) !== 0 || !fs.existsSync(archivo) || fs.statSync(archivo).isDirectory()) {
      res.writeHead(404); return res.end();
    }
    res.writeHead(200, { 'Content-Type': (TIPOS[path.extname(archivo)] || 'application/octet-stream') + '; charset=utf-8' });
    fs.createReadStream(archivo).pipe(res);
  });
  return new Promise(function (ok) {
    servidor.listen(0, '127.0.0.1', async function () {
      var base = 'http://127.0.0.1:' + servidor.address().port;
      var salida = [];
      for (var i = 0; i < urls.length; i++) salida.push(await abrir(base + urls[i], presupuesto));
      servidor.close();
      ok(salida);
    });
  });
}

// [[caso, valor], ...] de la sonda -> { caso: valor }.
function mapa(res) { var o = {}; (res ? res.r : []).forEach(function (x) { o[x[0]] = x[1]; }); return o; }

module.exports = { CHROME: CHROME, pagina: pagina, correr: correr, mapa: mapa };
