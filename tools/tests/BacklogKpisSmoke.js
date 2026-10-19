// tools/tests/BacklogKpisSmoke.js - prueba de humo de la fila de KPIs del
// tablero de Backlog:
//
//   - ya no hay tarjeta "Altos";
//   - Dentro SLA y Fuera SLA van en UNA tarjeta, cada cifra con su rotulo, y
//     salen de la suma del result set 6 (sla) -no de una suma de las dos-;
//   - 'Dentro SLA(Subestado)' no se mezcla con ninguna: va contado en el pie;
//   - el cross-filter por lider recorta tambien la tarjeta de SLA;
//   - el semaforo sigue los cortes 5% / 15% del correo de direccion.
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
function linea(prefijo) {
  var ini = fuente.indexOf(prefijo);
  if (ini < 0) { console.log('FAIL  ' + prefijo + ' no esta en backlog.js'); process.exit(1); }
  return fuente.slice(ini, fuente.indexOf('\n', ini));
}

var nodos = { 'kpis-bl': { innerHTML: '' }, 'f-corte-bl': { value: '2026-10-19' } };
var documento = { getElementById: function (id) { return nodos[id]; } };

var codigo = [
  linea('const FMT = '), linea('const PCT = '),
  recortar('dimensionesActivas', ''), recortar('htmlTarjetasKpi', ''), recortar('htmlParKpi', ''),
  linea('const SORT_MAS_30 = '),
  'let datos = null;',
  'const filtro = { lider: null, grupo: null, prioridad: null, aging: null };',
  recortar('hayFiltro', '  '), recortar('porLiderGrupo', '  '), recortar('renderKpis', '  '),
  'return { renderKpis: renderKpis, filtro: filtro, poner: function (d) { datos = d; } };',
].join('\n');
var m = (new Function('document', codigo))(documento);

var resumen = {
  kpis: { BacklogTotal: 3400, Criticos: 10, Altos: 500, Mayor30Dias: 900, Reasignados: 40, Reabiertos: 5 },
  prioridad: [
    { Lider: 'Ana', Grupo: 'G1', Critica: 6, Alta: 300, Total: 2000 },
    { Lider: 'Beto', Grupo: 'G2', Critica: 4, Alta: 200, Total: 1400 },
  ],
  aging: [], reasignaciones: [], reabiertos: [],
  sla: [
    { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Dentro SLA', Tickets: 200 },
    { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Fuera SLA', Tickets: 1700 },
    { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Dentro SLA(Subestado)', Tickets: 100 },
    { Lider: 'Beto', Grupo: 'G2', EstadoSLA: 'Dentro SLA', Tickets: 76 },
    { Lider: 'Beto', Grupo: 'G2', EstadoSLA: 'Fuera SLA', Tickets: 1310 },
    { Lider: 'Beto', Grupo: 'G2', EstadoSLA: 'Dentro SLA(Subestado)', Tickets: 14 },
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
  var r = new RegExp('<small>' + rotulo.replace(/[()]/g, '\\$&') + '</small>([^<]*)</span>').exec(t);
  return r ? r[1] : '(sin cifra)';
}

// ---- Sin filtro
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
Check('Dentro SLA = suma del result set 6', (276).toLocaleString('es-MX'), cifra(t, 'Dentro SLA'));
Check('Fuera SLA = suma del result set 6', (3010).toLocaleString('es-MX'), cifra(t, 'Fuera SLA'));
Check('no hay cifra combinada', false, t.indexOf((3286).toLocaleString('es-MX')) >= 0);
Check('subestado en el pie, no sumado', true, t.indexOf('114 dentro por subestado') >= 0);
Check('% fuera sobre todo el SLA (3010/3400)', true, t.indexOf('89% fuera') >= 0);
Check('semaforo rojo con 89% fuera', true, t.indexOf('sr">') === 0);

// ---- Cross-filter por lider
m.filtro.lider = 'Beto';
m.renderKpis();
t = tarjeta('Dentro / Fuera SLA');
Check('filtro: Dentro SLA de Beto', '76', cifra(t, 'Dentro SLA'));
Check('filtro: Fuera SLA de Beto', (1310).toLocaleString('es-MX'), cifra(t, 'Fuera SLA'));
Check('filtro: Backlog de Beto', (1400).toLocaleString('es-MX'), /<div class="val">([^<]*)<\/div>/.exec(tarjeta('Backlog'))[1]);
m.filtro.lider = null;

// ---- Semaforo y vacios
resumen.sla = [{ Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Dentro SLA', Tickets: 95 },
               { Lider: 'Ana', Grupo: 'G1', EstadoSLA: 'Fuera SLA', Tickets: 5 }];
m.renderKpis();
t = tarjeta('Dentro / Fuera SLA');
Check('semaforo verde con 5% fuera', true, t.indexOf('sv">') === 0);
Check('sin subestado no hay texto de subestado', false, t.indexOf('subestado') >= 0);
resumen.sla = [];
m.renderKpis();
t = tarjeta('Dentro / Fuera SLA');
Check('sin filas: cifras en cero', '0|0', cifra(t, 'Dentro SLA') + '|' + cifra(t, 'Fuera SLA'));
Check('sin filas: sin semaforo', true, t.indexOf('">') === 0);

console.log(fallos === 0 ? '\nTODO OK' : '\n' + fallos + ' FALLO(S)');
process.exit(fallos === 0 ? 0 : 1);
