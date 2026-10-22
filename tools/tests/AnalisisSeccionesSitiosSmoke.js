// tools/tests/AnalisisSeccionesSitiosSmoke.js - prueba de humo de lo que no le
// sirve a todos los servicios en analisis/motor.js (2026-10-21):
//   - secciones.quincena: la tabla, la grafica y el hallazgo del pago solo salen
//     si el servicio la prende; sin ella, la serie diaria con los picos.
//   - servicio.cedis: la tabla de los CEDIS que nombra el texto.
//   - UMBRAL_SITIOS (30%): con menos tickets con sitio no se mide por sitio y los
//     tres indicadores de sitio cambian por Con sitio / Reabiertos / Abiertos vencidos.
//   - leerSecciones / seccionesATexto / scriptServicio (con y sin secciones).
//   - trabajo.js como script normal (el camino sin Worker) pasa las secciones.
//
// NO forma parte del sitio: vive fuera de analisis/. Usa el motor.js REAL, el
// trabajo.js REAL y el vendor de ExcelJS de la pagina. Datos sinteticos: no
// toca ninguna base.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\AnalisisSeccionesSitiosSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var Motor = require(path.join(raiz, 'analisis', 'motor.js'));
var ExcelJS = require(path.join(raiz, 'analisis', 'vendor', 'exceljs.min.js'));
var AnalisisTrabajo = require(path.join(raiz, 'analisis', 'trabajo.js')).AnalisisTrabajo;

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}
function Ok(caso, cond, detalle) { Check(caso, true, !!cond + (cond ? '' : '  (' + detalle + ')')); }

/* ------------------------------------------------------------------ datos */
var COLS = ['CodigoTicket', 'Origen', 'Tipo', 'Categoria', 'Estado', 'Subestado', 'Prioridad', 'SLA', 'TipoRelacion', 'Grupo',
            'TipoSitio', 'SitioNumero', 'Tienda', 'FechaRegistro', 'FechaEstimadaResolucion', 'FechaFirmaSolucion',
            'FechaFirmaCierre', 'FechaUltimaModificacion', 'IntentosSolucion', 'ReasignacionesGrupo',
            'Titulo', 'Descripcion', 'SolucionUsuario'];
function dos(n) { return (n < 10 ? '0' : '') + n; }
function dia(base, d, h) {
  var f = new Date(base + d * 86400000);
  return f.getUTCFullYear() + '-' + dos(f.getUTCMonth() + 1) + '-' + dos(f.getUTCDate()) + ' ' + dos(h) + ':00:00';
}
var INICIO = Date.UTC(2026, 6, 1);   // 2026-07-01, 61 dias

// n tickets; conSitio(i) dice cuales traen tienda. Cada 7o queda abierto con la
// fecha estimada ya pasada; el 5o, abierto con la fecha en el futuro; cada 10o,
// reabierto (IntentosSolucion 2). El texto del 3o nombra el CEDIS 5549.
function tickets(n, conSitio) {
  var filas = [];
  for (var i = 0; i < n; i++) {
    var d = i % 61, sitio = conSitio(i), abierto = i % 7 === 6, futuro = i === 4;
    filas.push({
      CodigoTicket: 'INC 2026-' + (100000 + i), Origen: 'Portal', Tipo: 'Incidencia', Categoria: '/S-Prueba/Falla',
      Estado: abierto || futuro ? 'En Proceso' : 'Cerrada', Subestado: '', Prioridad: 'Media', SLA: 'Estandar', TipoRelacion: '',
      Grupo: 'Mesa', TipoSitio: sitio ? 'Tienda' : 'Persona u otro', SitioNumero: sitio ? String(1000 + (i % 37)) : null,
      Tienda: sitio ? (1000 + (i % 37)) + ' Monterrey' : 'Perez Lopez, Juan',
      FechaRegistro: dia(INICIO, d, 9 + (i % 8)),
      FechaEstimadaResolucion: futuro ? '2027-01-01 00:00:00' : dia(INICIO, d, 20),
      FechaFirmaSolucion: abierto || futuro ? null : dia(INICIO, d, 18),
      FechaFirmaCierre: abierto || futuro ? null : dia(INICIO, d, 19),
      FechaUltimaModificacion: '2026-09-01 08:00:00',
      IntentosSolucion: i % 10 === 9 ? '2' : '1', ReasignacionesGrupo: '0',
      Titulo: i % 3 === 0 ? 'No imprime' : 'No enciende', Descripcion: i === 2 ? 'Reporta el cedis 5549 Salinas' : 'Falla en caja',
      SolucionUsuario: 'Se reinicia'
    });
  }
  return filas;
}
function preparar(filas) {
  return Motor.preparar({ bloques: [{ tipo: 'tickets', cols: COLS, filas: filas, descartadas: [] }], avisos: [], corte: null });
}
var REGLAS = [{ id: 'R01', motivo: 'Impresora', campo: 'D', frases: ['imprime'] }];
function analizar(filas, extra) {
  var s = { nombre: 'Prueba', reglas: REGLAS };
  Object.keys(extra || {}).forEach(function (k) { s[k] = extra[k]; });
  return Motor.analizar(preparar(filas), s, { conTextos: true });
}
function ids(lista) { return (lista || []).map(function (t) { return t.id; }).join(','); }
function kpi(res, nombre) {
  var t = res.hojas.Resumen.filter(function (x) { return x.id === 'kpi'; })[0];
  var f = t.filas.filter(function (r) { return r[0] === nombre; })[0];
  return f ? f[1] : undefined;
}
// Ningun numero raro (NaN o Infinity) en lo que se pinta ni en lo que va al Excel.
function sinRaros(res) {
  var malos = [];
  (function ver(v, donde) {
    if (typeof v === 'number' && !isFinite(v)) malos.push(donde);
    else if (typeof v === 'string' && /NaN|Infinity/.test(v)) malos.push(donde + '="' + v + '"');
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { ver(v[k], donde + '.' + k); });
  })({ hojas: res.hojas, hallazgos: res.hallazgos, graficas: res.graficas, cifras: res.cifras }, 'res');
  return malos;
}

/* -------------------------------------------------------- leerSecciones */
var L = Motor.leerSecciones;
Check('leer: null apaga todo', '{"quincena":false,"cedis":null}', JSON.stringify(L(null)));
Check('leer: vacio apaga todo', '{"quincena":false,"cedis":null}', JSON.stringify(L('')));
Check('leer: JSON roto apaga todo', '{"quincena":false,"cedis":null}', JSON.stringify(L('{quincena:true')));
Check('leer: un arreglo apaga todo', '{"quincena":false,"cedis":null}', JSON.stringify(L('[true]')));
Check('leer: "true" en texto no prende', false, L('{"quincena":"true"}').quincena);
Check('leer: 1 no prende', false, L('{"quincena":1}').quincena);
Check('leer: true prende', true, L('{"quincena":true}').quincena);
Check('leer: cedis vacio queda null', 'null', JSON.stringify(L('{"cedis":{}}').cedis));
Check('leer: cedis arreglo queda null', 'null', JSON.stringify(L('{"cedis":["5549"]}').cedis));
Check('leer: cedis con valores raros se limpia', '{"5549":"Salinas","5550":"7"}',
      JSON.stringify(L('{"cedis":{"5549":"Salinas","5550":7,"5551":null,"5552":{"a":1},"5553":""}}').cedis));
Check('ida y vuelta', '{"quincena":true,"cedis":{"5548":"Tultitlan","5549":"Salinas"}}',
      Motor.seccionesATexto(L(Motor.seccionesATexto({ quincena: true, cedis: { 5549: 'Salinas', 5548: 'Tultitlan' } }))));
Check('seccionesATexto: nada prendido es null', 'null', String(Motor.seccionesATexto({ quincena: false, cedis: {} })));
Check('seccionesATexto: undefined es null', 'null', String(Motor.seccionesATexto(undefined)));

/* -------------------------------------------------------------- quincena */
var base = tickets(400, function (i) { return i % 2 === 0; });
var conQ = analizar(base, { secciones: { quincena: true } });
var sinQ = analizar(base, { secciones: { quincena: false } });
var sinNada = analizar(base);
var basura = analizar(base, { secciones: L('no es json') });

Ok('prendida: tabla quincena en Temporal', ids(conQ.hojas.Temporal).indexOf('quincena') >= 0, ids(conQ.hojas.Temporal));
Check('prendida: grafica de 15 dias', 15, conQ.graficas.quincena && conQ.graficas.quincena.length);
Ok('prendida: cifras del pago', conQ.cifras.antesPago != null && conQ.cifras.despuesPago != null, JSON.stringify([conQ.cifras.antesPago, conQ.cifras.despuesPago]));
Ok('prendida: hallazgo del pago', conQ.hallazgos.some(function (h) { return /^Alrededor del pago/.test(h); }), conQ.hallazgos.join(' / '));

[['apagada', sinQ], ['sin secciones', sinNada], ['secciones ilegibles', basura]].forEach(function (x) {
  var n = x[0], r = x[1];
  Ok(n + ': sin tabla quincena', ids(r.hojas.Temporal).indexOf('quincena') < 0, ids(r.hojas.Temporal));
  Check(n + ': sin grafica quincena', 'null', String(r.graficas.quincena));
  Check(n + ': sin cifras del pago', 'null|null', r.cifras.antesPago + '|' + r.cifras.despuesPago);
  Ok(n + ': sin hallazgo del pago', !r.hallazgos.some(function (h) { return /pago/i.test(h); }), r.hallazgos.join(' / '));
  Ok(n + ': Temporal sin la palabra quincena', JSON.stringify(r.hojas.Temporal).indexOf('quincena') < 0, 'aparece');
});

// La serie diaria es la misma con o sin quincena: un punto por dia completo, con los picos de la tabla.
Check('diaria: un punto por dia completo (hasta el dia antes del corte)', 62, sinQ.graficas.diaria.length);
Check('diaria: igual con y sin quincena', JSON.stringify(conQ.graficas.diaria), JSON.stringify(sinQ.graficas.diaria));
Check('diaria: suma los tickets del periodo', base.length, sinQ.graficas.diaria.reduce(function (a, x) { return a + x.n; }, 0));
Check('diaria: primer y ultimo dia', '2026-07-01|2026-08-31', sinQ.graficas.diaria[0].dia + '|' + sinQ.graficas.diaria[61].dia);
var picosTabla = sinQ.hojas.Temporal.filter(function (t) { return t.id === 'picos'; })[0];
Check('diaria: picos = filas de la tabla de picos', picosTabla.filas.length, sinQ.graficas.diaria.filter(function (x) { return x.pico; }).length);
// Un pico de verdad: 60 tickets mas un dia.
var conPico = base.concat(tickets(60, function () { return true; }).map(function (f, i) {
  f.CodigoTicket = 'INC 2026-' + (900000 + i); f.FechaRegistro = '2026-07-15 10:00:00'; return f;
}));
var rp = analizar(conPico);
var pico = rp.graficas.diaria.filter(function (x) { return x.pico; });
Check('diaria: marca el dia pico', '2026-07-15', pico.map(function (x) { return x.dia; }).join(','));
Check('diaria: el pico coincide con la tabla', 1, rp.hojas.Temporal.filter(function (t) { return t.id === 'picos'; })[0].filas.length);
Ok('diaria: trae el promedio de su dia de la semana', pico[0].base > 0, pico[0].base);
// Las demas tablas de Temporal no cambian con la quincena.
Check('Temporal igual salvo la quincena', JSON.stringify(conQ.hojas.Temporal.filter(function (t) { return t.id !== 'quincena'; })),
      JSON.stringify(sinQ.hojas.Temporal));
Check('meses igual con y sin quincena', JSON.stringify(conQ.graficas.meses), JSON.stringify(sinQ.graficas.meses));

/* ----------------------------------------------------------------- CEDIS */
var conCedis = analizar(base, { cedis: { '5549': 'Salinas Victoria secos' } });
var cedisT = conCedis.hojas.Sitios.filter(function (t) { return t.id === 'cedis'; })[0];
Ok('CEDIS: con el mapa sale la tabla', !!cedisT, ids(conCedis.hojas.Sitios));
Check('CEDIS: el ticket que lo nombra', '5549|Salinas Victoria secos|1', cedisT && cedisT.filas.map(function (f) { return f[0] + '|' + f[1] + '|' + f[2]; }).join(';'));
Ok('CEDIS: sin el mapa no sale', ids(sinNada.hojas.Sitios).indexOf('cedis') < 0, ids(sinNada.hojas.Sitios));
var desdeTexto = analizar(base, { cedis: L('{"cedis":{"5549":"Salinas"}}').cedis });
Ok('CEDIS: el mapa leido de Secciones tambien', desdeTexto.hojas.Sitios.some(function (t) { return t.id === 'cedis'; }), ids(desdeTexto.hojas.Sitios));
Ok('CEDIS: un nombre de servicio parecido no la prende', ids(analizar(base, { nombre: 'S-Logística' }).hojas.Sitios).indexOf('cedis') < 0, 'salio');

/* ------------------------------------------------------- umbral de sitios */
Check('UMBRAL_SITIOS exportado', 0.3, Motor.UMBRAL_SITIOS);
function porcentaje(n, k) { return analizar(tickets(n, function (i) { return i < k; })); }
var casos = [
  ['0 de 20 con sitio', porcentaje(20, 0), true],
  ['5 de 20 (25%)', porcentaje(20, 5), true],
  ['299 de 1000 (29.9%)', porcentaje(1000, 299), true],
  ['300 de 1000 (30% exacto)', porcentaje(1000, 300), false],
  ['3 de 10 (30% exacto, chico)', porcentaje(10, 3), false],
  ['301 de 1000 (30.1%)', porcentaje(1000, 301), false],
  ['1 de 1 (100%)', porcentaje(1, 1), false],
  ['0 de 1', porcentaje(1, 0), true]
];
casos.forEach(function (c) {
  var n = c[0], r = c[1], pocos = c[2], ts = ids(r.hojas.Sitios);
  Check(n + ': pocosSitios', pocos, r.cifras.pocosSitios);
  Check(n + ': Sitios ' + (pocos ? 'solo trae Quien reporta' : 'trae las tablas por sitio'), pocos ? 'tipo' : 'tipo,conc,top,reinc', ts.replace(/,equipo|,cedis/g, ''));
  Check(n + ': Concentracion', pocos, kpi(r, 'Concentración') === 'no se mide');
  Check(n + ': Reincidencia', pocos, kpi(r, 'Reincidencia a 30 días') === 'no se mide');
  Ok(n + ': hallazgo de sitios coherente', pocos
     ? r.hallazgos.some(function (h) { return /no se mide por sitio/.test(h); }) && !r.hallazgos.some(function (h) { return /^Reincidencia/.test(h); })
     : r.hallazgos.some(function (h) { return /^Reincidencia/.test(h); }), r.hallazgos.join(' / '));
  Ok(n + ': nota de Quien reporta dice el porcentaje', r.hojas.Sitios[0].nota.indexOf(Motor.pctTxt(r.cifras.conSitio)) >= 0, r.hojas.Sitios[0].nota);
  Check(n + ': sin NaN ni Infinity', '', sinRaros(r).join(', '));
});
Check('29.9%: conSitio', 0.299, casos[2][1].cifras.conSitio);
Check('30%: conSitio', 0.3, casos[3][1].cifras.conSitio);
Ok('pocos: la nota explica el corte', /menos del 30%/i.test(casos[1][1].hojas.Sitios[0].nota), casos[1][1].hojas.Sitios[0].nota);
Ok('pocos: el pico no dice de cuantos sitios', !casos[0][1].hallazgos.some(function (h) { return /pico.* sitios\./.test(h); }), casos[0][1].hallazgos.join(' / '));

// Reabiertos y Abiertos vencidos: las definiciones de siempre (IntentosSolucion > 1;
// sin firma y con la fecha estimada antes del corte).
var r20 = casos[1][1], f20 = tickets(20, function (i) { return i < 5; });
var corte20 = Date.UTC(2026, 8, 1, 8);
var esperadosVenc = f20.filter(function (f) { return f.FechaFirmaSolucion == null && Date.parse(f.FechaEstimadaResolucion.replace(' ', 'T') + 'Z') < corte20; }).length;
Check('abiertos vencidos (a mano)', esperadosVenc, r20.cifras.abiertosVencidos);
Ok('abiertos vencidos no cuenta el de fecha futura', esperadosVenc === f20.filter(function (f) { return f.FechaFirmaSolucion == null; }).length - 1, esperadosVenc);
Check('reabiertos (a mano)', f20.filter(function (f) { return +f.IntentosSolucion > 1; }).length / 20, r20.cifras.reabiertos);
Check('Indicadores: Reabiertos = cifra', Motor.pctTxt(r20.cifras.reabiertos), kpi(r20, 'Reabiertos'));
Check('Indicadores: Abiertos vencidos = cifra', Motor.miles(r20.cifras.abiertosVencidos), kpi(r20, 'Abiertos vencidos'));
Check('Indicadores: Tickets con sitio = cifra', Motor.pctTxt(0.25), kpi(r20, 'Tickets con sitio'));

// Sin tickets: preparar avisa y no hay analisis que pintar.
var vacio = preparar([]);
Ok('sin tickets: preparar devuelve error', !!vacio.error, JSON.stringify(vacio).slice(0, 120));

/* ------------------------------------------------------ Probar reglas */
var otras = Motor.textoAReglas('R01 | Arranque | D | enciende').reglas;
var r1 = analizar(base), r2 = Motor.analizar(preparar(base), { nombre: 'Prueba', reglas: otras }, { conTextos: true });
var dsPrep = preparar(base);
var a1 = Motor.analizar(dsPrep, { nombre: 'Prueba', reglas: REGLAS }, { conTextos: true });
var a2 = Motor.analizar(dsPrep, { nombre: 'Prueba', reglas: otras }, { conTextos: true });
Check('reglas: el motivo principal cambia con las reglas', 'Impresora|Arranque', a1.cifras.motivos.filter(function (m) { return m[0] !== Motor.SIN_CLASIFICAR; })[0][0] + '|' +
      a2.cifras.motivos.filter(function (m) { return m[0] !== Motor.SIN_CLASIFICAR; })[0][0]);
Check('reglas: reclasificar los mismos tickets da lo mismo que de cero', JSON.stringify(r2.cifras.motivos), JSON.stringify(a2.cifras.motivos));
Check('reglas: y de vuelta', JSON.stringify(r1.cifras.motivos), JSON.stringify(Motor.analizar(dsPrep, { nombre: 'Prueba', reglas: REGLAS }, { conTextos: true }).cifras.motivos));

/* ----------------------------------------------------- Generar script */
var S = {
  clave: 'prueba', nombre: 'S-Prueba', descripcion: null, desdeSugerido: null,
  criterios: [{ clave: 'Ruta', valor: '/S-Prueba/%' }], reglas: REGLAS, motivosEquipo: []
};
function con(extra) { var o = {}; Object.keys(S).forEach(function (k) { o[k] = S[k]; }); Object.keys(extra).forEach(function (k) { o[k] = extra[k]; }); return o; }
var sqlSin = Motor.scriptServicio(S).sql, sqlApagado = Motor.scriptServicio(con({ secciones: { quincena: false, cedis: null } })).sql;
var sqlCon = Motor.scriptServicio(con({ secciones: { quincena: true, cedis: { '5549': "O'Brien" } } })).sql;
Ok('script sin secciones: no escribe la columna', sqlSin && !/Secciones =|, Secciones\)|COL_LENGTH/.test(sqlSin), sqlSin);
Check('script con secciones apagadas = sin secciones', sqlSin.replace(/\d{4}-\d\d-\d\d \d\d:\d\d/g, ''), sqlApagado.replace(/\d{4}-\d\d-\d\d \d\d:\d\d/g, ''));
Ok('script sin secciones: el guard de siempre', sqlSin.indexOf("IF OBJECT_ID('dbo.AnalisisRegla') IS NULL\n") >= 0, 'sin guard');
Ok('script con secciones: pide la columna', sqlCon.indexOf("COL_LENGTH('dbo.AnalisisServicio', 'Secciones') IS NULL") >= 0, 'sin COL_LENGTH');
Ok('script con secciones: la guarda (comilla escapada)', sqlCon.indexOf("Secciones = N'{\"quincena\":true,\"cedis\":{\"5549\":\"O''Brien\"}}') AS o") >= 0, sqlCon);
Ok('script con secciones: UPDATE e INSERT la llevan', /Secciones = o\.Secciones/.test(sqlCon) && /MotivosEquipo, Secciones\)/.test(sqlCon) && /o\.MotivosEquipo, o\.Secciones\)/.test(sqlCon), 'falta');
Ok('script sin secciones: MERGE bien cerrado', /MotivosEquipo = N'\[\]'\) AS o/.test(sqlSin), sqlSin);
Ok('script: nombre de mas de 100 no pasa', (Motor.scriptServicio(con({ nombre: new Array(102).join('x') })).errores || []).some(function (e) { return /100/.test(e); }), 'paso');
Ok('script: descripcion de mas de 400 no pasa', (Motor.scriptServicio(con({ descripcion: new Array(402).join('x') })).errores || []).some(function (e) { return /400/.test(e); }), 'paso');
Ok('script: criterio de mas de 400 sigue sin pasar', (Motor.scriptServicio(con({ criterios: [{ clave: 'Ruta', valor: new Array(402).join('x') }] })).errores || []).length > 0, 'paso');
Ok('script: nombre de 100 si pasa', !(Motor.scriptServicio(con({ nombre: new Array(101).join('x') })).errores || []).length, 'no paso');

/* ----------------------------------------- trabajo.js sin Worker (respaldo) */
function bloque(columnas, filas) { return { columnas: columnas, filas: filas }; }
var resp = {
  servicio: 'prueba', desde: '2026-07-01', hasta: '2026-08-30',
  bloques: {
    parametros: bloque(['Bloque', 'Clave', 'Valor'], [['0) Parametros', 'Servicio', 'S-Prueba'], ['0) Parametros', 'Secciones', '{"quincena":true}']]),
    reglas: bloque(['Orden', 'Regla', 'Motivo', 'Campo', 'Frases'], [['1', 'R01', 'Impresora', 'D', '["imprime"]']]),
    tickets: bloque(COLS, base.map(function (f) { return COLS.map(function (c) { return f[c]; }); }))
  }
};
var trabajo = new AnalisisTrabajo(Motor), avisos = [];
var c = trabajo.cargar(new TextEncoder().encode(JSON.stringify(resp)).buffer, function (t) { avisos.push(t); });
Check('trabajo: carga los tickets', base.length, c.tickets);
Check('trabajo: la respuesta trae Secciones en parametros', '{"quincena":true}',
      c.respuesta.bloques.parametros.filas.filter(function (f) { return f[1] === 'Secciones'; })[0][2]);
var sec = Motor.leerSecciones('{"quincena":true}');
var tq = trabajo.analizar({ nombre: 'S-Prueba', reglas: c.reglas, motivosEquipo: [], secciones: { quincena: sec.quincena }, cedis: sec.cedis }, function () {});
var tn = trabajo.analizar({ nombre: 'S-Prueba', reglas: c.reglas, motivosEquipo: [] }, function () {});
Ok('trabajo: con secciones sale la quincena', tq.resultado.graficas.quincena && tq.resultado.graficas.quincena.length === 15, 'no');
Check('trabajo: sin secciones no', 'null', String(tn.resultado.graficas.quincena));
// El Worker pasa el servicio con structuredClone: las secciones llegan igual.
if (typeof structuredClone === 'function') {
  var clon = structuredClone({ secciones: { quincena: true }, cedis: { '5549': 'Salinas' } });
  Check('structuredClone conserva secciones y cedis', '{"secciones":{"quincena":true},"cedis":{"5549":"Salinas"}}', JSON.stringify(clon));
}

/* ------------------------------------------------------------- Excel */
(async function () {
  async function libro(res) {
    var buf = await Motor.armarLibro(res, ExcelJS).xlsx.writeBuffer();
    var wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    var out = {};
    wb.eachSheet(function (ws) { var t = []; ws.eachRow(function (r) { r.eachCell(function (cl) { t.push(String(cl.value)); }); }); out[ws.name] = t.join('\n'); });
    return out;
  }
  var xq = await libro(conQ), xn = await libro(sinQ), xp = await libro(casos[1][1]), xm = await libro(casos[5][1]);
  Ok('Excel prendida: Temporal con la quincena', /Alrededor del pago/.test(xq.Temporal), 'falta');
  Ok('Excel apagada: Temporal sin la quincena', !/Alrededor del pago|quincena/i.test(xn.Temporal), 'aparece');
  Ok('Excel apagada: Temporal conserva picos y meses', /Días pico/.test(xn.Temporal) && /Por mes|mes/i.test(xn.Temporal), 'faltan');
  Ok('Excel pocos sitios: Sitios explica el corte', /menos del 30%/.test(xp.Sitios) && !/Concentración/.test(xp.Sitios), xp.Sitios.slice(0, 300));
  Ok('Excel pocos sitios: Resumen con Abiertos vencidos', /Abiertos vencidos/.test(xp.Resumen) && /no se mide/.test(xp.Resumen), 'falta');
  Ok('Excel muchos sitios: Sitios con Concentración y Reincidencia', /Concentración/.test(xm.Sitios) && /Reincidencia/.test(xm.Sitios), 'faltan');
  Ok('Excel: sin NaN ni Infinity', !/NaN|Infinity/.test(JSON.stringify([xq, xn, xp, xm])), 'aparece');

  console.log(fallos ? '\n' + fallos + ' caso(s) fallaron' : '\nTodo paso');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
