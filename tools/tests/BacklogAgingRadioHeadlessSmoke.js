// tools/tests/BacklogAgingRadioHeadlessSmoke.js - "Por antiguedad" de Backlog
// (backlog/backlog.js, PILA_REDONDA): cada pila apilada redondea sus DOS
// extremos exteriores y deja rectas las uniones entre lideres, en un Chrome
// de verdad (tools/tests/BancoHeadless.js; no escribe en disco salvo PNG=).
//
// Lee pixeles del canvas: una esquina redondeada no tiene el color del
// segmento; el centro de cada extremo y los dos lados de una union, si.
//
//   A0     con los datos de mock tal cual: todas las pilas cumplen y el
//          plugin no toca los datos de la grafica;
//   R0-R5  datos de prueba puestos en la grafica (solo en memoria): un solo
//          lider, varios, serie intermedia y final en cero, barra muy chica,
//          punta de 1-2px y cubo vacio;
//   H1     apagar en la leyenda la serie de la punta: el extremo pasa a la
//          serie anterior y sigue redondo;
//   O1     las otras graficas de Backlog no llevan el plugin.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\BacklogAgingRadioHeadlessSmoke.js   # PASS/FAIL, sale 0 si todo paso
//   set PNG=<carpeta>  -> ademas guarda una captura por escenario
//
// Sin Chrome instalado dice SKIP y sale 0. Otra ruta: CHROME=<ruta>.
'use strict';
var fs = require('fs');
var path = require('path');
var Banco = require('./BancoHeadless');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}
if (!Banco.CHROME) { console.log('SKIP  sin Chrome/Edge (CHROME=<ruta> para indicar otro)'); process.exit(0); }

// Sin animacion: los pixeles se leen sobre la geometria final.
var ANTES = '<script>window.MockData.MOCK_DATA = true; Element.prototype.scrollIntoView = function () {};' +
  ' Chart.defaults.animation = false;</script>\n';

function sonda() {
  var R = [], errores = [], imagenes = {};
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 4000; t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  function g() { return Chart.getChart('chart-aging-bl'); }

  var rgbDe = (function () {
    var c = document.createElement('canvas').getContext('2d');
    return function (color) {
      c.clearRect(0, 0, 1, 1); c.fillStyle = color; c.fillRect(0, 0, 1, 1);
      var d = c.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2]];
    };
  })();
  function pixel(ch, x, y) {
    var k = ch.currentDevicePixelRatio || 1;
    var d = ch.ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }
  // Mismo color del segmento (opaco y a menos de 40 de distancia RGB).
  function es(ch, x, y, color) {
    var p = pixel(ch, x, y), c = rgbDe(color);
    var dist = Math.sqrt(Math.pow(p[0] - c[0], 2) + Math.pow(p[1] - c[1], 2) + Math.pow(p[2] - c[2], 2));
    return p[3] > 200 && dist < 40;
  }

  /* Revisa una fila: segmentos visibles con ancho, extremos, esquinas y
     uniones. Devuelve la lista de problemas (vacia = bien). */
  function revisarFila(ch, j) {
    var segs = [];
    ch.data.datasets.forEach(function (ds, i) {
      if (!ch.isDatasetVisible(i)) return;
      var el = ch.getDatasetMeta(i).data[j];
      var a = Math.min(el.base, el.x), b = Math.max(el.base, el.x);
      if (b - a > 0.5) segs.push({ i: i, a: a, b: b, y: el.y, h: el.height, color: ds.backgroundColor });
    });
    if (!segs.length) return { segs: 0, problemas: [] };
    var x0 = segs[0].a, x1 = segs[segs.length - 1].b, y = segs[0].y - segs[0].h / 2, h = segs[0].h;
    var r = Math.min(Barras.RADIO, h / 2, (x1 - x0) / 2);
    var malos = [];
    var primero = segs[0], ultimo = segs[segs.length - 1];
    if (primero.b - primero.a >= 3 && !es(ch, x0 + 1.5, y + h / 2, primero.color)) malos.push('extremo izq sin color');
    if (ultimo.b - ultimo.a >= 3 && !es(ch, x1 - 1.5, y + h / 2, ultimo.color)) malos.push('extremo der sin color');
    if (r >= 4) {
      [[x0 + 1, y + 1, primero], [x0 + 1, y + h - 1, primero], [x1 - 1, y + 1, ultimo], [x1 - 1, y + h - 1, ultimo]]
        .forEach(function (q, n) { if (es(ch, q[0], q[1], q[2].color)) malos.push('esquina ' + n + ' cuadrada'); });
    }
    for (var s = 1; s < segs.length; s++) {
      var bx = segs[s].a, A = segs[s - 1], B = segs[s];
      if (A.b - A.a < 4 || B.b - B.a < 4 || bx - 2 < x0 + r || bx + 2 > x1 - r) continue;
      if (!es(ch, bx - 2, y + 1, A.color) || !es(ch, bx + 2, y + 1, B.color)) malos.push('union ' + s + ' no recta');
    }
    return { segs: segs.length, r: Math.round(r * 10) / 10, problemas: malos };
  }

  function poner(filas) {
    var ch = g();
    ch.data.datasets.forEach(function (ds, i) {
      ds.data = ch.data.labels.map(function (_, j) { return (filas[j] && filas[j][i]) || 0; });
    });
    ch.update('none');
  }

  (async function () {
    try {
      await hasta(function () { return g() && g().data.datasets.length; });
      // La pagina puede volver a crear la grafica tras la primera carga: se
      // espera a que la instancia deje de cambiar antes de medir.
      for (var previa = null; previa !== g(); ) { previa = g(); await espera(400); }
      var ch = g();
      apunta('INFO', { filas: ch.data.labels.length, series: ch.data.datasets.length });

      var antes = JSON.stringify(ch.data.datasets.map(function (d) { return d.data; }));
      ch.draw();
      var despues = JSON.stringify(ch.data.datasets.map(function (d) { return d.data; }));
      var todas = ch.data.labels.map(function (_, j) { return revisarFila(ch, j).problemas; });
      apunta('A0', [antes === despues, todas.every(function (p) { return !p.length; }), todas]);
      imagenes.mock = ch.toBase64Image();

      poner([
        [400],              // R0 un solo lider
        [300, 300, 400],    // R1 varios segmentos
        [300, 0, 300],      // R2 intermedia en cero; las demas (finales) en cero
        [12],               // R3 barra muy chica
        [500, 0, 2],        // R4 punta de 1-2px
        [],                 // R5 cubo vacio
      ]);
      ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'].forEach(function (c, j) {
        var f = revisarFila(ch, j); apunta(c, [f.segs, f.r, f.problemas]);
      });
      imagenes.casos = ch.toBase64Image();

      ch.hide(2); ch.update('none');
      var h = revisarFila(ch, 1); apunta('H1', [h.segs, h.problemas]);
      imagenes.leyenda = ch.toBase64Image();
      ch.show(2); ch.update('none');

      // S1 clic en un cubo: la pila elegida lleva contorno oscuro tambien en
      // el arranque y la punta, por dentro de las esquinas redondas. El clic
      // vuelve a pintar con los datos de mock.
      ch.getElementsAtEventForMode = function () { return [{ index: 1 }]; };
      ch.options.onClick({}, [], ch);
      await hasta(function () { return g() && g().getDatasetMeta(0).data[1].options.borderWidth === 3; });
      ch = g();
      var e0 = ch.getDatasetMeta(0).data[1], e2 = ch.getDatasetMeta(2).data[1];
      var oscuro = function (x, y) { var p = pixel(ch, x, y); return p[3] > 200 && p[0] < 90 && p[1] < 90 && p[2] < 90; };
      var arriba = e0.y - e0.height / 2;
      apunta('S1', [oscuro(e0.base + 1.5, e0.y), oscuro(e2.x - 1.5, e0.y), oscuro((e0.base + e2.x) / 2, arriba + 1.5),
                    !oscuro(e0.base + 0.5, arriba + 0.5)]);
      imagenes.seleccion = ch.toBase64Image();

      apunta('O1', ['chart-prioridad-bl', 'chart-lider-bl'].map(function (id) {
        var o = Chart.getChart(id);
        return !o || !o.config.plugins.some(function (p) { return p.id === 'pilaRedonda'; });
      }));
    } catch (e) { errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R, img: imagenes });
    document.body.appendChild(pre);
  })();
}

var BANCO = Banco.pagina('backlog/backlog.html', 'backlog.js', ANTES, sonda);
Banco.correr({ '/backlog/__banco.html': BANCO }, ['/backlog/__banco.html']).then(function (res) {
  if (!res[0]) { console.log('FAIL  Chrome no devolvio el resultado de la sonda'); process.exit(1); }
  Check('S0 sin errores de JS en la pagina', [], res[0].errores);
  var o = Banco.mapa(res[0]);
  console.log('INFO  ' + JSON.stringify(o.INFO));
  Check('A0 mock: datos intactos y todas las pilas con extremos redondos y uniones rectas', true, !!(o.A0 && o.A0[0] && o.A0[1]));
  if (o.A0 && !o.A0[1]) console.log('      ' + JSON.stringify(o.A0[2]));
  Check('R0 un solo lider: un segmento, radio 6, sin problemas', [1, 6, []], o.R0);
  Check('R1 tres lideres: radio 6 en los extremos, uniones rectas', [3, 6, []], o.R1);
  Check('R2 serie intermedia y finales en cero: dos segmentos, extremos redondos', [2, 6, []], o.R2);
  Check('R3 barra muy chica: un segmento, sin problemas', [1, o.R3 && o.R3[1], []], o.R3);
  Check('R3 radio limitado a la mitad del largo (< 6)', true, !!(o.R3 && o.R3[1] < 6 && o.R3[1] > 0));
  Check('R4 punta de 1-2px: el extremo derecho sigue redondo', [2, 6, []], o.R4);
  Check('R5 cubo vacio: sin pila', [0, null, []], o.R5);
  Check('H1 apagar la serie de la punta en la leyenda: extremo en la anterior, redondo', [2, []], o.H1);
  Check('S1 cubo elegido: contorno en arranque, punta y borde; esquina exterior fuera', [true, true, true, true], o.S1);
  Check('O1 las otras graficas no llevan el plugin', [true, true], o.O1);

  if (process.env.PNG && res[0].img) {
    Object.keys(res[0].img).forEach(function (k) {
      var b = String(res[0].img[k]).replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(process.env.PNG, 'aging-' + k + '.png'), Buffer.from(b, 'base64'));
    });
  }
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
