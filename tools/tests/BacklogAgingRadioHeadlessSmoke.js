// tools/tests/BacklogAgingRadioHeadlessSmoke.js - "Por antiguedad" de Backlog
// (backlog/backlog.js, renderBarrasAging): barras apiladas CUADRADAS -extremos
// y uniones entre lideres sin radio-, aunque Barras.aplicarDefaults() deje
// Barras.RADIO de default para todo `bar`. En un Chrome de verdad
// (tools/tests/BancoHeadless.js; no escribe en disco salvo PNG=).
//
// Lee pixeles del canvas a 1px de cada esquina exterior: con cualquier radio
// ese pixel queda fuera de la barra; cuadrada, tiene el color del segmento.
//
//   A0     con los datos de mock tal cual: todas las pilas cuadradas y los
//          datos de la grafica sin tocar;
//   R0-R5  datos de prueba puestos en la grafica (solo en memoria): un solo
//          lider, varios, serie intermedia y final en cero, barra muy chica,
//          punta de 1-2px y cubo vacio;
//   H1     apagar en la leyenda la serie de la punta: el nuevo extremo,
//          cuadrado;
//   V1     pila bajo el cursor (estado activo): sigue cuadrada;
//   S1     cubo elegido: contorno de seleccion hasta las esquinas;
//   O1     las demas barras de Backlog conservan el radio compartido.
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
// Barras.aplicarDefaults(): la pagina suelta no lo llama, dashboard.js si
// (Backlog va montado ahi), y es lo que trae Barras.RADIO a esta grafica.
var ANTES = '<script>window.MockData.MOCK_DATA = true; Element.prototype.scrollIntoView = function () {};' +
  ' Chart.defaults.animation = false; Barras.aplicarDefaults();</script>\n';

function sonda() {
  var R = [], errores = [], imagenes = {};
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 4000; t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  function g() { return Chart.getChart('chart-aging-bl'); }

  function pixel(ch, x, y) {
    var k = ch.currentDevicePixelRatio || 1;
    var d = ch.ctx.getImageData(Math.round(x * k), Math.round(y * k), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }
  // Mismo color (opaco y a menos de 40 de distancia RGB) que el pixel de
  // referencia: asi vale igual con el color normal que con el de hover.
  function igual(p, q) {
    var dist = Math.sqrt(Math.pow(p[0] - q[0], 2) + Math.pow(p[1] - q[1], 2) + Math.pow(p[2] - q[2], 2));
    return p[3] > 200 && q[3] > 200 && dist < 40;
  }
  function oscuro(p) { return p[3] > 200 && p[0] < 90 && p[1] < 90 && p[2] < 90; }

  // Segmentos visibles y con ancho de la fila j, en orden de pila.
  function segmentos(ch, j) {
    var segs = [];
    ch.data.datasets.forEach(function (ds, i) {
      if (!ch.isDatasetVisible(i)) return;
      var el = ch.getDatasetMeta(i).data[j];
      var a = Math.min(el.base, el.x), b = Math.max(el.base, el.x);
      if (b - a > 0.5) segs.push({ a: a, b: b, y: el.y - el.height / 2, h: el.height });
    });
    return segs;
  }

  /* Revisa una fila: las cuatro esquinas exteriores con el color del
     segmento de su extremo y cada union con el color de sus dos lados arriba
     y abajo. Los pixeles van 1px adentro por izquierda/arriba y 1.5px por
     derecha/abajo: el borde cae en fraccion de pixel y el redondeo de la
     coordenada no debe salirse de la barra. Devuelve los problemas. */
  function revisarFila(ch, j) {
    var segs = segmentos(ch, j);
    if (!segs.length) return { segs: 0, problemas: [] };
    var p0 = segs[0], pn = segs[segs.length - 1];
    var arriba = p0.y + 1, abajo = p0.y + p0.h - 1.5, medio = p0.y + p0.h / 2;
    var malos = [];
    if (p0.b - p0.a >= 3) {
      var refIzq = pixel(ch, p0.a + 1, medio);
      if (!igual(pixel(ch, p0.a + 1, arriba), refIzq)) malos.push('esquina izq-arriba no cuadrada');
      if (!igual(pixel(ch, p0.a + 1, abajo), refIzq)) malos.push('esquina izq-abajo no cuadrada');
    }
    if (pn.b - pn.a >= 3) {
      var refDer = pixel(ch, pn.b - 1.5, medio);
      if (!igual(pixel(ch, pn.b - 1.5, arriba), refDer)) malos.push('esquina der-arriba no cuadrada');
      if (!igual(pixel(ch, pn.b - 1.5, abajo), refDer)) malos.push('esquina der-abajo no cuadrada');
    }
    for (var s = 1; s < segs.length; s++) {
      var A = segs[s - 1], B = segs[s], bx = B.a;
      if (A.b - A.a < 4 || B.b - B.a < 4) continue;
      var refA = pixel(ch, bx - 2, medio), refB = pixel(ch, bx + 2, medio);
      if (!igual(pixel(ch, bx - 2, arriba), refA) || !igual(pixel(ch, bx + 2, arriba), refB) ||
          !igual(pixel(ch, bx - 2, abajo), refA) || !igual(pixel(ch, bx + 2, abajo), refB)) {
        malos.push('union ' + s + ' no recta');
      }
    }
    return { segs: segs.length, problemas: malos };
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
        var f = revisarFila(ch, j); apunta(c, [f.segs, f.problemas]);
      });
      imagenes.casos = ch.toBase64Image();

      ch.hide(2); ch.update('none');
      var h = revisarFila(ch, 1); apunta('H1', [h.segs, h.problemas]);
      imagenes.leyenda = ch.toBase64Image();
      ch.show(2); ch.update('none');

      ch.setActiveElements([0, 1, 2].map(function (i) { return { datasetIndex: i, index: 1 }; }));
      ch.update('none');
      var v = revisarFila(ch, 1); apunta('V1', [v.segs, v.problemas]);
      ch.setActiveElements([]); ch.update('none');

      // El clic vuelve a pintar con los datos de mock.
      ch.getElementsAtEventForMode = function () { return [{ index: 1 }]; };
      ch.options.onClick({}, [], ch);
      await hasta(function () { return g() && g().getDatasetMeta(0).data[1].options.borderWidth === 3; });
      ch = g();
      var sel = segmentos(ch, 1), s0 = sel[0], sn = sel[sel.length - 1];
      apunta('S1', [[s0.a + 1, s0.y + 1], [s0.a + 1, s0.y + s0.h - 1.5], [sn.b - 1.5, s0.y + 1], [sn.b - 1.5, s0.y + s0.h - 1.5]]
        .map(function (q) { return oscuro(pixel(ch, q[0], q[1])); }));
      imagenes.seleccion = ch.toBase64Image();

      apunta('O1', ['chart-prioridad-bl', 'chart-lider-bl'].map(function (id) {
        var o = Chart.getChart(id);
        return o ? o.getDatasetMeta(0).data[0].options.borderRadius : 'sin grafica';
      }).concat(Barras.RADIO));
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
  Check('A0 mock: datos intactos y todas las pilas cuadradas', [true, true], o.A0 && o.A0.slice(0, 2));
  if (o.A0 && !o.A0[1]) console.log('      ' + JSON.stringify(o.A0[2]));
  Check('R0 un solo lider: extremos cuadrados', [1, []], o.R0);
  Check('R1 tres lideres: extremos cuadrados, uniones rectas', [3, []], o.R1);
  Check('R2 serie intermedia y finales en cero: extremos cuadrados', [2, []], o.R2);
  Check('R3 barra muy chica: cuadrada', [1, []], o.R3);
  Check('R4 punta de 1-2px: el resto de la pila cuadrada', [2, []], o.R4);
  Check('R5 cubo vacio: sin segmentos', [0, []], o.R5);
  Check('H1 apagar la serie de la punta en la leyenda: nuevo extremo cuadrado', [2, []], o.H1);
  Check('V1 pila activa (hover): cuadrada', [3, []], o.V1);
  Check('S1 cubo elegido: contorno oscuro en las cuatro esquinas', [true, true, true, true], o.S1);
  Check('O1 las demas barras conservan el radio compartido', [6, 6, 6], o.O1);

  if (process.env.PNG && res[0].img) {
    Object.keys(res[0].img).forEach(function (k) {
      var b = String(res[0].img[k]).replace(/^data:image\/png;base64,/, '');
      fs.writeFileSync(path.join(process.env.PNG, 'aging-' + k + '.png'), Buffer.from(b, 'base64'));
    });
  }
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
