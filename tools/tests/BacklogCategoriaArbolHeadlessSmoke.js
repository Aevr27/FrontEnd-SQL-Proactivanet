// tools/tests/BacklogCategoriaArbolHeadlessSmoke.js - el arbol de "Líder
// (Categoría)" del tablero de Backlog (backlog/backlog.js,
// renderLideresCategoria / activarArbolCategoria / abrirTicketsCat) en un
// Chrome de verdad (tools/tests/BancoHeadless.js; no escribe en disco).
//
// Datos: los de assets/js/mock-data.js, encendidos SOLO en la copia en
// memoria de backlog/backlog.html, y para backlog_categorias.ashx -que el
// mock no tiene- un proveedor de prueba aqui mismo, con tickets sinteticos
// de rutas de varios niveles. mock-data.js no se toca.
//
//   A0     arranca plegado: solo se ven los lideres;
//   A1-A4  desplegar lider, C1, Hardware, Impresora (cuatro niveles) y
//          plegar el C1: se esconde y se cierra todo su subarbol; al volver
//          a abrirlo solo salen sus hijos directos;
//   A5     cada padre suma sus hijos y los lideres suman los tickets;
//   A6     clic en una categoria: pide sus tickets con los filtros de arriba,
//          el lider y la ruta del nodo; la lista cuadra con la fila y el
//          arbol sigue abierto;
//   A7     cross-filter por grupo desde "Líder (Grupo)": la tabla y los
//          tickets se recortan al grupo y siguen cuadrando;
//   A8-A9  otro clic cierra los tickets; el nombre del lider sigue filtrando
//          el tablero sin plegar el arbol.
//
//   node tools\tests\BacklogCategoriaArbolHeadlessSmoke.js
//
// Sin Chrome instalado dice SKIP y sale 0. Otra ruta: CHROME=<ruta>.
'use strict';
var Banco = require('./BancoHeadless');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}
if (!Banco.CHROME) { console.log('SKIP  sin Chrome/Edge (CHROME=<ruta> para indicar otro)'); process.exit(0); }

function proveedor() {
  window.MockData.MOCK_DATA = true;
  Element.prototype.scrollIntoView = function () {};
  var original = window.MockData.obtenerJSONMock;
  var rutas = ['/S-Punto de Venta/Aplicativo/Caja', '/S-Punto de Venta/Aplicativo',
    '/S-Punto de Venta/Hardware/Impresora/Termica', '/S-Punto de Venta/Hardware/Impresora/Laser',
    '/S-Logistica/CEDIS/Andenes', '/S-Logistica'];
  var lideres = ['Lider Norte', 'Lider Centro'], grupos = ['Aplicaciones', 'Infraestructura'];
  var T = [];
  for (var i = 0; i < 120; i++) {
    var cat = rutas[i % rutas.length];
    T.push({ CodigoTicket: 'T' + i, Lider: lideres[Math.floor(i / 6) % 2], Grupo: grupos[Math.floor(i / 12) % 2], C1: cat.split('/')[1],
      Categoria: cat, Prioridad: i % 5 === 0 ? 'Critica' : (i % 3 === 0 ? 'Alta' : 'Media'), AgingSort: i % 8,
      EstadoSLA: i % 4 === 0 ? 'Fuera SLA' : 'Dentro SLA', FechaRegistro: '2026-0' + (1 + i % 9) + '-10T00:00:00', DiasBacklog: i });
  }
  window.__T = T;
  window.__pedidos = [];
  window.MockData.obtenerJSONMock = function (ruta) {
    if (String(ruta).split('?')[0].split('/').pop() !== 'backlog_categorias.ashx') return original(ruta);
    window.__pedidos.push(String(ruta));
    var q = new URLSearchParams(String(ruta).split('?')[1] || '');
    if (q.get('modo') === 'tickets') {
      var r = q.get('nodo_ruta') ? JSON.parse(q.get('nodo_ruta')) : [];
      var pref = '/' + q.get('nodo_c1') + (r.length ? '/' + r.join('/') : '');
      var l = T.filter(function (t) {
        return t.Lider === q.get('nodo_lider') && t.C1 === q.get('nodo_c1') && (!q.get('nodo_grupo') || t.Grupo === q.get('nodo_grupo'))
          && (q.get('nodo_exacto') ? t.Categoria === pref : (t.Categoria === pref || t.Categoria.indexOf(pref + '/') === 0));
      });
      return { tickets: l, total: l.length, tope: 500 };
    }
    var m = {};
    T.forEach(function (t) {
      var k = [t.Lider, t.Grupo, t.C1, t.Categoria].join('|');
      var o = m[k] || (m[k] = { Lider: t.Lider, Grupo: t.Grupo, C1: t.C1, Categoria: t.Categoria, Critica: 0, Alta: 0, Mas30: 0, FueraSLA: 0, Total: 0 });
      o.Total++; if (t.Prioridad === 'Critica') o.Critica++; if (t.Prioridad === 'Alta') o.Alta++;
      if (t.AgingSort >= 5) o.Mas30++; if (t.EstadoSLA === 'Fuera SLA') o.FueraSLA++;
    });
    return { filas: Object.keys(m).map(function (k) { return m[k]; }) };
  };
}
var ANTES = '<script>(' + proveedor.toString() + ')();</script>\n';

function sonda() {
  var R = [], errores = [];
  window.addEventListener('error', function (e) { errores.push(String(e.message)); });
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  async function hasta(fn) { for (var t = 0; !fn() && t < 4000; t += 25) await espera(25); return fn(); }
  function apunta(caso, v) { R.push([caso, v]); }
  var C = '#tabla-lideres-cat-bl';
  function filas() { return Array.prototype.slice.call(document.querySelectorAll(C + ' tbody tr')); }
  function nombre(tr) { return tr.querySelector('td').textContent.replace(/\s+/g, ' ').trim(); }
  function fila(camino) {
    var actual = null;
    for (var i = 0; i < camino.length; i++) {
      var padre = actual;
      actual = filas().filter(function (tr) {
        return (padre ? tr.dataset.p === padre.dataset.id : tr.classList.contains('n1row')) && nombre(tr) === camino[i];
      })[0];
      if (!actual) return null;
    }
    return actual;
  }
  function hijos(tr) { return filas().filter(function (x) { return x.dataset.p === tr.dataset.id; }); }
  function seVe(tr) { return getComputedStyle(tr).display !== 'none'; }
  function vistos() { return filas().filter(seVe).map(nombre); }
  function num(tr) { return Number(tr.querySelectorAll('td')[1].textContent.replace(/[^\d]/g, '')); }
  function clic(camino) { fila(camino).querySelector('td').click(); }
  function verTickets(camino) { fila(camino).querySelector('.ver-tickets').click(); }
  function panel() { return document.getElementById('tickets-cat-bl'); }
  function filasTickets() { return panel().querySelectorAll('tbody tr').length; }
  function ultimo() { var p = window.__pedidos; return new URLSearchParams(p[p.length - 1].split('?')[1]); }
  function descuadres() {
    return filas().filter(function (tr) { return hijos(tr).length; }).filter(function (tr) {
      return hijos(tr).reduce(function (a, h) { return a + num(h); }, 0) !== num(tr);
    }).map(nombre);
  }
  var N = 'Lider Norte', PDV = [N, 'S-Punto de Venta'], HW = PDV.concat('Hardware'), IMP = HW.concat('Impresora');
  (async function () {
    try {
      await hasta(function () { return document.querySelectorAll(C + ' .n1row').length > 0; });
      document.querySelector('.tab[data-panel="p-lideres-cat-bl"]').click();
      apunta('A0', [document.querySelectorAll(C + ' .n1row').length, vistos()]);
      clic([N]); await espera(30);
      apunta('A1', [hijos(fila([N])).filter(seVe).map(nombre), hijos(fila(PDV)).filter(seVe).length]);
      clic(PDV); await espera(30);
      apunta('A2', [hijos(fila(PDV)).filter(seVe).map(nombre), seVe(fila(IMP))]);
      clic(HW); await espera(30); clic(IMP); await espera(30);
      apunta('A3', [seVe(fila(IMP)), hijos(fila(IMP)).filter(seVe).map(nombre)]);
      clic(PDV); await espera(30);
      var bajoPdv = filas().filter(function (tr) { return tr.classList.contains('a-' + fila(PDV).dataset.id); });
      apunta('A4a', [bajoPdv.length > 0, bajoPdv.filter(seVe).length, bajoPdv.filter(function (x) { return x.classList.contains('open'); }).length]);
      clic(PDV); await espera(30);
      apunta('A4b', [hijos(fila(PDV)).filter(seVe).map(nombre), seVe(fila(IMP)), fila(HW).classList.contains('open')]);
      var lid = filas().filter(function (tr) { return tr.classList.contains('n1row'); });
      apunta('A5', [descuadres(), lid.reduce(function (a, tr) { return a + num(tr); }, 0), window.__T.length]);

      clic(HW); await espera(30);
      verTickets(IMP);
      await hasta(function () { return !panel().hidden && filasTickets() > 0; });
      var q = ultimo();
      apunta('A6', [q.get('modo'), q.get('nodo_lider'), q.get('nodo_c1'), q.get('nodo_ruta'), q.has('fecha_corte'), q.get('nodo_grupo'),
        filasTickets() === num(fila(IMP)), fila(IMP).classList.contains('fila-sel'), seVe(fila(IMP))]);

      var g = document.querySelector('#tabla-lideres-bl .filtrable[data-dim="grupo"][data-valor="Aplicaciones"]');
      g.click();
      await hasta(function () { return ultimo().get('nodo_grupo') === 'Aplicaciones' && filasTickets() > 0; }); await espera(30);
      var esperadoNorte = window.__T.filter(function (t) { return t.Lider === N && t.Grupo === 'Aplicaciones'; }).length;
      apunta('A7', [num(fila([N])) === esperadoNorte, descuadres(), ultimo().get('nodo_grupo'), filasTickets() === num(fila(IMP)),
        seVe(fila(IMP))]);

      verTickets(IMP); await espera(30);
      apunta('A8', [panel().hidden, fila(IMP).classList.contains('fila-sel')]);
      fila([N]).querySelector('.filtrable[data-dim="lider"]').click(); await espera(60);
      apunta('A9', [fila([N]).classList.contains('fila-sel'), seVe(fila(IMP)), descuadres()]);
    } catch (e) { errores.push('sonda: ' + e.message); }
    var pre = document.createElement('pre');
    pre.id = '__res';
    pre.textContent = JSON.stringify({ errores: errores, r: R });
    document.body.appendChild(pre);
  })();
}

var BANCO = Banco.pagina('backlog/backlog.html', 'backlog.js', ANTES, sonda);
Banco.correr({ '/backlog/__banco.html': BANCO }, ['/backlog/__banco.html']).then(function (res) {
  if (!res[0]) { console.log('FAIL  Chrome no devolvio el resultado de la sonda'); process.exit(1); }
  Check('S0 sin errores de JS en la pagina', [], res[0].errores);
  var o = Banco.mapa(res[0]);
  Check('A0 arranca plegado: solo los dos lideres a la vista', [2, ['Lider Centro', 'Lider Norte']], o.A0);
  Check('A1 abrir lider: sus C1, nada mas abajo', [['S-Punto de Venta', 'S-Logistica'], 0], o.A1);
  Check('A2 abrir C1: sus hijos directos; Impresora sigue oculta', [['Aplicativo', 'Hardware'], false], o.A2);
  Check('A3 cuatro niveles: Hardware > Impresora > Termica/Laser', [true, ['Laser', 'Termica']], o.A3);
  Check('A4a plegar el C1: todo su subarbol oculto y cerrado', [true, 0, 0], o.A4a);
  Check('A4b reabrir el C1: solo hijos directos, Hardware cerrado', [['Aplicativo', 'Hardware'], false, false], o.A4b);
  Check('A5 cada padre suma sus hijos; los lideres suman todos los tickets', [[], 120, 120], o.A5);
  Check('A6 tickets de Impresora: filtros + lider + ruta, cuadran con la fila, fila marcada, arbol abierto',
    ['tickets', 'Lider Norte', 'S-Punto de Venta', '["Hardware","Impresora"]', true, null, true, true, true], o.A6);
  Check('A7 grupo Aplicaciones: lider recortado, arbol cuadra, tickets repedidos con el grupo y cuadran',
    [true, [], 'Aplicaciones', true, true], o.A7);
  Check('A8 otro clic en la categoria cierra los tickets', [true, false], o.A8);
  Check('A9 el nombre del lider filtra sin plegar el arbol', [true, true, []], o.A9);
  console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
  process.exit(fallos === 0 ? 0 : 1);
});
