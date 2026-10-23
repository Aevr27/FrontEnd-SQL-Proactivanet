// tools/tests/BacklogKpisSmoke.js - prueba de humo de la fila de KPIs del
// tablero de Backlog:
//
//   - ya no hay tarjeta "Altos";
//   - Dentro SLA y Fuera SLA van en UNA tarjeta, cada cifra con su rotulo y
//     sin sumarlas; sin cross-filter salen de kpis.DentroSLA / FueraSLA del
//     procedimiento, con cross-filter del result set 6 con su misma regla
//     (Dentro = 'Dentro SLA' + 'Dentro SLA(Subestado)');
//   - 'Tramite de compra' no es ni dentro ni fuera: va contado en el pie;
//   - el cross-filter por lider recorta tambien la tarjeta de SLA;
//   - el semaforo sigue los cortes 5% / 15% del correo de direccion;
//   - "Criticos" es la unica tarjeta que filtra (SeleccionKpi): su marca
//     sigue a filtro.prioridad = 'Critica' (la barra Critica), las cifras
//     no cambian, y el pie dice "sobre lo filtrado" solo con Lider o Grupo.
//
// NO forma parte del sitio. Recorta las funciones de backlog/backlog.js -sin
// copiarlas- y las corre con un document de mentira.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\BacklogKpisSmoke.js   # PASS/FAIL, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var fuente = fs.readFileSync(path.join(raiz, 'backlog', 'backlog.js'), 'utf8')
  .split(String.fromCharCode(13)).join('');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

// Funcion anidada en el IIFE (dos espacios de sangria) o de primer nivel.
function recortar(nombre, sangria) {
  var firma = '\n' + sangria + 'function ' + nombre + '(';
  var ini = fuente.indexOf(firma);
  if (ini < 0) { console.log('FAIL  ' + nombre + ' no esta en backlog.js'); process.exit(1); }
  var fin = fuente.indexOf('\n' + sangria + '}\n', ini);
  return fuente.slice(ini, fin + sangria.length + 3);
}
// Desde `desde` hasta el cierre de la funcion `hasta` (sangria de dos).
function tramo(desde, hasta) {
  var ini = fuente.indexOf(desde);
  var fn = fuente.indexOf('\n  function ' + hasta + '(', ini);
  if (ini < 0 || fn < 0) { console.log('FAIL  ' + desde + ' / ' + hasta + ' no estan en backlog.js'); process.exit(1); }
  return fuente.slice(ini, fuente.indexOf('\n  }\n', fn) + 5);
}
function linea(prefijo) {
  var ini = fuente.indexOf(prefijo);
  if (ini < 0) { console.log('FAIL  ' + prefijo + ' no esta en backlog.js'); process.exit(1); }
  return fuente.slice(ini, fuente.indexOf('\n', ini));
}

var nodos = { 'kpis-bl': { innerHTML: '' }, 'f-corte-bl': { value: '2026-10-19' } };
var documento = { getElementById: function (id) { return nodos[id]; } };
var ventana = {};
(new Function('window', fs.readFileSync(path.join(raiz, 'assets', 'js', 'seleccion-kpi.js'), 'utf8')))(ventana);

var codigo = [
  linea('const FMT = '), linea('const PCT = '),
  recortar('dimensionesActivas', ''), recortar('htmlTarjetasKpi', ''), recortar('htmlParKpi', ''),
  linea('const SORT_MAS_30 = '),
  'let datos = null;',
  'const filtro = { lider: null, grupo: null, prioridad: null, aging: null };',
  tramo('  const KPI_CRITICOS = ', 'marcarKpis'),
  recortar('hayFiltro', '  '), recortar('porLiderGrupo', '  '), recortar('renderKpis', '  '),
  'return { renderKpis: renderKpis, filtro: filtro, poner: function (d) { datos = d; } };',
].join('\n');
var m = (new Function('document', 'window', codigo))(documento, ventana);

// Cifras del corte 2026-10-19 en la VM (diag_backlog_subestados.sql sec 8):
// Fuera SLA 3173, Tramite de compra 1042, Dentro SLA 179, Dentro SLA(Subestado)
// 128; total 4522. Repartidas entre dos lideres de mentira.
var resumen = {
  kpis: { BacklogTotal: 4522, Criticos: 10, Altos: 500, Mayor30Dias: 900, Reasignados: 40, Reabiertos: 5,
          DentroSLA: 307, FueraSLA: 3173, TramiteCompra: 1042 },
  prioridad: [
    { Lider: 'Ana', Grupo: 'G1', Critica: 6, Alta: 300, Total: 2880 },
    { Lider: 'Beto', Grupo: 'G2', Critica: 4, Alta: 200, Total: 1642 },
  ],
  aging: [], reasignaciones: [], reabiertos: [],
  sla: [
    { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Dentro SLA', Tickets: 100 },
    { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Dentro SLA(Subestado)', Tickets: 80 },
    { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Fuera SLA', Tickets: 2000 },
    { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Tramite de compra', Tickets: 700 },
    { Lider: 'Beto', Grupo: 'G2', EstadoSLA: 'Dentro SLA', Tickets: 79 },
    { Lider: 'Beto', Grupo: 'G2', EstadoSLA: 'Dentro SLA(Subestado)', Tickets: 48 },
    { Lider: 'Beto', Grupo: 'G2', EstadoSLA: 'Fuera SLA', Tickets: 1173 },
    { Lider: 'Beto', Grupo: 'G2', EstadoSLA: 'Tramite de compra', Tickets: 342 },
  ],
};
m.poner({ resumen: resumen });

function tarjetas() {
  return nodos['kpis-bl'].innerHTML.split('<div class="kpi ').slice(1);
}
function tarjeta(rotulo) {
  return tarjetas().filter(function (t) { return t.indexOf('<div class="lbl">' + rotulo + '</div>') >= 0; })[0] || '';
}
function cifra(t, rotulo) {
  var r = new RegExp('<small>' + rotulo.replace(/[()]/g, '\$&') + '</small>([^<]*)</span>').exec(t);
  return r ? r[1] : '(sin cifra)';
}
var N = function (n) { return n.toLocaleString('es-MX'); };

// ---- Sin filtro: las cifras salen de las columnas del result set 1
m.renderKpis();
var html = nodos['kpis-bl'].innerHTML;
Check('sin tarjeta Altos', false, html.indexOf('<div class="lbl">Altos</div>') >= 0);
Check('seis tarjetas (Altos fuera, SLA dentro)', 6, tarjetas().length);
Check('Backlog sigue', true, tarjeta('Backlog') !== '');
Check('Criticos sigue', true, tarjeta('Criticos') !== '');
Check('+30 dias sigue', true, tarjeta('+30 dias') !== '');
Check('Reasignados sigue', true, tarjeta('Reasignados') !== '');
Check('Reabiertos sigue', true, tarjeta('Reabiertos') !== '');
var t = tarjeta('Dentro / Fuera SLA');
Check('una sola tarjeta de SLA', 1, tarjetas().filter(function (x) { return x.indexOf('SLA') >= 0; }).length);
Check('Dentro SLA = kpis.DentroSLA', N(307), cifra(t, 'Dentro SLA'));
Check('Fuera SLA = kpis.FueraSLA', N(3173), cifra(t, 'Fuera SLA'));
Check('no hay cifra combinada', false, t.indexOf(N(3480)) >= 0);
Check('tramite de compra en el pie', true, t.indexOf(N(1042) + ' en tramite de compra') >= 0);
Check('% fuera sobre el backlog (3173/4522)', true, t.indexOf('70% fuera') >= 0);
Check('semaforo rojo con 70% fuera', true, t.indexOf('sr">') === 0);

// Sin filtro manda el procedimiento, no una suma propia del result set 6.
resumen.kpis.DentroSLA = 999;
m.renderKpis();
Check('sin filtro no se recalcula: usa kpis.DentroSLA', '999', cifra(tarjeta('Dentro / Fuera SLA'), 'Dentro SLA'));
resumen.kpis.DentroSLA = 307;

// ---- Cross-filter por lider: result set 6 con la regla del procedimiento
m.filtro.lider = 'Beto';
m.renderKpis();
t = tarjeta('Dentro / Fuera SLA');
Check('filtro: Dentro SLA de Beto (79 + 48 por subestado)', '127', cifra(t, 'Dentro SLA'));
Check('filtro: Fuera SLA de Beto', N(1173), cifra(t, 'Fuera SLA'));
Check('filtro: tramite de Beto en el pie', true, t.indexOf('342 en tramite de compra') >= 0);
Check('filtro: % fuera de Beto (1173/1642)', true, t.indexOf('71% fuera') >= 0);
Check('filtro: Backlog de Beto', N(1642), /<div class="val">([^<]*)<\/div>/.exec(tarjeta('Backlog'))[1]);
m.filtro.lider = null;

// ---- Procedimiento anterior, sin las columnas nuevas: cae al result set 6
var kpisViejos = resumen.kpis;
resumen.kpis = { BacklogTotal: 4522, Criticos: 10, Mayor30Dias: 900, Reasignados: 40, Reabiertos: 5 };
m.renderKpis();
t = tarjeta('Dentro / Fuera SLA');
Check('sin columnas SLA en kpis: Dentro del result set 6', '307', cifra(t, 'Dentro SLA'));
Check('sin columnas SLA en kpis: Fuera del result set 6', N(3173), cifra(t, 'Fuera SLA'));
resumen.kpis = kpisViejos;

// ---- Semaforo y vacios (con cross-filter, para leer del result set 6)
m.filtro.lider = 'Ana';
resumen.sla = [{ Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Dentro SLA', Tickets: 95 },
               { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Fuera SLA', Tickets: 5 }];
m.renderKpis();
t = tarjeta('Dentro / Fuera SLA');
Check('semaforo verde con 5% fuera', true, t.indexOf('sv">') === 0);
Check('sin tramite no hay texto de tramite', false, t.indexOf('tramite') >= 0);
resumen.sla = [];
m.renderKpis();
t = tarjeta('Dentro / Fuera SLA');
Check('sin filas: cifras en cero', '0|0', cifra(t, 'Dentro SLA') + '|' + cifra(t, 'Fuera SLA'));
Check('sin filas: sin semaforo', true, t.indexOf('">') === 0);
m.filtro.lider = null;

// ---- "Criticos" filtra (SeleccionKpi) ------------------------------------
function pulsada(rotulo) {
  var r = /aria-pressed="(true|false)"/.exec(tarjeta(rotulo));
  return r ? r[1] : '(sin boton)';
}
function val(rotulo) { return /<div class="val">([^<]*)<\/div>/.exec(tarjeta(rotulo))[1]; }
m.renderKpis();
Check('solo Criticos lleva boton que filtra', 1, (nodos['kpis-bl'].innerHTML.match(/class="kpi-filtro"/g) || []).length);
Check('Criticos: boton con data-indicador y sin elegir', 'false', pulsada('Criticos'));
Check('Criticos: tarjeta filtrable sin marca', true,
  tarjeta('Criticos').indexOf('kpi-filtrable') >= 0 && tarjeta('Criticos').indexOf('kpi-sel') < 0);
Check('Criticos: nombre accesible con la cifra', true, tarjeta('Criticos').indexOf('aria-label="Criticos: 10"') >= 0);
Check('Backlog no filtra', '(sin boton)', pulsada('Backlog'));
Check('pie sin filtro: el corte', true, tarjeta('Backlog').indexOf('corte 2026-10-19') >= 0);
m.filtro.prioridad = 'Critica';
m.renderKpis();
Check('prioridad Critica: Criticos marcada', 'true', pulsada('Criticos'));
Check('prioridad Critica: tarjeta con kpi-sel', true, tarjeta('Criticos').indexOf('kpi-sel') >= 0);
Check('prioridad Critica: las cifras no cambian', [N(4522), '10'].join('|'), [val('Backlog'), val('Criticos')].join('|'));
Check('prioridad Critica: el pie NO dice "sobre lo filtrado"', false, tarjeta('Backlog').indexOf('sobre lo filtrado') >= 0);
m.filtro.prioridad = 'Alta';
m.renderKpis();
Check('otra prioridad (barra Alta): Criticos sin marca', 'false', pulsada('Criticos'));
m.filtro.prioridad = 'Critica';
m.filtro.lider = 'Ana';
m.renderKpis();
Check('con Lider: el pie dice "sobre lo filtrado"', true, tarjeta('Backlog').indexOf('sobre lo filtrado') >= 0);
Check('con Lider y Critica: Criticos sigue marcada', 'true', pulsada('Criticos'));
m.filtro.prioridad = null;
m.filtro.lider = null;

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
