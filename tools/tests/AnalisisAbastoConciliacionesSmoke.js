// tools/tests/AnalisisAbastoConciliacionesSmoke.js - prueba de humo de los dos
// servicios del 2026-10-21 de la pestaña "Analisis de servicios":
//   - sql/79_analisis_s_abasto.sql (S-Abasto, 27 reglas) y
//     sql/80_analisis_s_conciliaciones.sql (Conciliaciones, 19 reglas): lo que dan
//     de alta, que las frases ya vengan normalizadas (si no, nunca pegan), que
//     quepan en las columnas del 47 y que "Generar script" arme lo mismo.
//   - sql/78_analisis_secciones.sql: los dos estan en la lista y quedan sin nada prendido.
//   - Las reglas cargadas por el camino de la pestaña (trabajo.js con la respuesta
//     de analisis.ashx) clasifican tickets de ejemplo con la regla esperada.
//   - El hallazgo del dia pico: sin sitios no dice "de 0 sitios"; con sitios
//     sigue diciendo de cuantos.
//   - Editar reglas (texto de ida y vuelta) y el Excel siguen funcionando.
//
// NO forma parte del sitio ni corre SQL: lee los .sql como texto. Usa el motor.js
// REAL, el trabajo.js REAL y el vendor de ExcelJS de la pagina. Datos sinteticos.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\AnalisisAbastoConciliacionesSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
var Motor = require(path.join(raiz, 'analisis', 'motor.js'));
var ExcelJS = require(path.join(raiz, 'analisis', 'vendor', 'exceljs.min.js'));
var AnalisisTrabajo = require(path.join(raiz, 'analisis', 'trabajo.js')).AnalisisTrabajo;
var Sql = require(path.join(__dirname, 'AnalisisSqlServicio.js'));

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = String(esperado), o = String(obtenido);
  if (e === o) console.log('PASS  ' + caso);
  else { fallos++; console.log('FAIL  ' + caso + '\n      esperado: ' + e + '\n      obtenido: ' + o); }
}
function Ok(caso, cond, detalle) { Check(caso, true, !!cond + (cond ? '' : '  (' + detalle + ')')); }

function script(n) { return Sql.leerArchivo(path.join(raiz, 'sql', n)); }
var SERVICIOS = [
  { archivo: '79_analisis_s_abasto.sql', clave: 'abasto', nombre: 'S-Abasto', reglas: 27, frases: 229,
    criterios: [['Ruta', '/S-Abasto/%'], ['Titulo', '%abasto%'], ['Titulo', '%f&r%']] },
  { archivo: '80_analisis_s_conciliaciones.sql', clave: 'conciliaciones', nombre: 'Conciliaciones', reglas: 19, frases: 178,
    criterios: [['Ruta', '/Conciliaciones/%'], ['Titulo', '%concilia%']] }
];

/* ------------------------------------------------- lo que da de alta cada script */
SERVICIOS.forEach(function (e) {
  var sql = script(e.archivo), s = Sql.leerScriptServicio(sql), n = e.clave + ': ';
  e.sql = sql; e.s = s;
  e.reglasMotor = s.reglas.map(function (r) { return { id: r.id, motivo: r.motivo, campo: r.campo, frases: JSON.parse(r.frasesTexto) }; });
  Check(n + 'clave', e.clave, s.clave);
  Check(n + 'nombre', e.nombre, s.nombre);
  Check(n + 'reglas leidas', e.reglas, s.reglas.length);
  Check(n + 'reglas en el INSERT (ninguna sin leer)', e.reglas, s.tuplasRegla);
  Check(n + 'la cabecera dice las mismas reglas', e.reglas, s.cabecera && s.cabecera.reglas);
  Check(n + 'frases', e.frases, e.reglasMotor.reduce(function (a, r) { return a + r.frases.length; }, 0));
  Check(n + 'la cabecera dice las mismas frases', e.frases, s.cabecera && s.cabecera.frases);
  Check(n + 'criterios', JSON.stringify(e.criterios), JSON.stringify(s.criterios.map(function (c) { return [c.clave, c.valor]; })));
  Check(n + 'criterios en el INSERT (ninguno sin leer)', e.criterios.length, s.tuplasCriterio);
  Ok(n + 'tiene una Ruta (usp_Analisis_Datos la exige, o un Grupo)', s.criterios.some(function (c) { return c.clave === 'Ruta' || c.clave === 'Grupo'; }), 'sin Ruta ni Grupo');
  Check(n + 'Orden de 1 en adelante, sin huecos', s.reglas.map(function (_, i) { return i + 1; }).join(','), s.reglas.map(function (r) { return r.orden; }).join(','));
  Check(n + 'ids R01.. en orden', s.reglas.map(function (_, i) { return 'R' + (i < 9 ? '0' : '') + (i + 1); }).join(','), s.reglas.map(function (r) { return r.id; }).join(','));
  Check(n + 'sin secciones (NULL)', 'null', String(s.secciones));
  Check(n + 'sin motivos de equipo', '[]', JSON.stringify(s.motivosEquipo));
  Check(n + 'periodo sugerido', '2026-04-01', s.desdeSugerido);
  // Los anchos de dbo.AnalisisServicio / AnalisisRegla / AnalisisServicioCriterio del 47.
  Ok(n + 'nombre cabe (100)', s.nombre.length <= 100, s.nombre.length);
  Ok(n + 'descripcion cabe (400)', (s.descripcion || '').length <= 400, (s.descripcion || '').length);
  Ok(n + 'motivos caben (200)', s.reglas.every(function (r) { return r.motivo.length > 0 && r.motivo.length <= 200; }), 'alguno no');
  Ok(n + 'criterios caben (400)', s.criterios.every(function (c) { return c.valor.length <= 400; }), 'alguno no');
  Ok(n + 'campos D, S o DS', s.reglas.every(function (r) { return Motor.CAMPOS[r.campo]; }), 'alguno no');
  Ok(n + 'cada regla trae frases', e.reglasMotor.every(function (r) { return r.frases.length > 0; }), 'alguna vacia');
  // Una frase que no esta normalizada (acento, mayuscula, signo) nunca aparece en el texto normalizado.
  var malas = [];
  e.reglasMotor.forEach(function (r) {
    r.frases.forEach(function (f) {
      var nf = Motor.normalizar(f).trim(), esperada = (/^ /.test(f) ? ' ' : '') + nf + (/ $/.test(f) ? ' ' : '');
      if (!nf || esperada !== f) malas.push(r.id + ' ' + JSON.stringify(f));
    });
  });
  Check(n + 'todas las frases ya normalizadas', '', malas.join('; '));
  Ok(n + 'guard del 47 con Secciones', sql.indexOf("COL_LENGTH('dbo.AnalisisServicio', 'Secciones') IS NULL") >= 0, 'sin guard');
  Ok(n + 'todo o nada (XACT_ABORT + transaccion)', /SET XACT_ABORT ON;/.test(sql) && /BEGIN TRANSACTION;/.test(sql) && /COMMIT;/.test(sql), 'falta');
  var borra = sql.match(/DELETE FROM [^\n;]*/g) || [];
  Ok(n + 'solo borra lo de su servicio', borra.length === 2 && borra.every(function (b) { return /WHERE Servicio = '([a-z_]+)'$/.test(b) && b.indexOf("'" + e.clave + "'") > 0; }), borra.join(' / '));
  Ok(n + 'no hay UPDATE ni DROP fuera del MERGE', !/^\s*(UPDATE|DROP|ALTER|TRUNCATE)\b/m.test(sql), 'hay');

  // "Generar script" de la pestaña arma, para este servicio, los mismos criterios y reglas.
  var gen = Motor.scriptServicio({ clave: s.clave, nombre: s.nombre, descripcion: s.descripcion, desdeSugerido: s.desdeSugerido,
                                   criterios: s.criterios, reglas: e.reglasMotor, motivosEquipo: s.motivosEquipo });
  Check(n + 'Generar script sin errores', '', (gen.errores || []).join('; '));
  function cuerpo(t) { t = t.replace(/\r\n/g, '\n'); return t.slice(t.indexOf('DELETE FROM dbo.AnalisisServicioCriterio'), t.indexOf('COMMIT;')); }
  Check(n + 'Generar script: criterios y reglas iguales al .sql', cuerpo(sql), gen.sql && cuerpo(gen.sql));
  Ok(n + 'Generar script: sin secciones no toca la columna', gen.sql && !/Secciones =/.test(gen.sql), 'la toca');
});
Check('las dos claves son distintas', 2, new Set(SERVICIOS.map(function (e) { return e.s.clave; })).size);

/* ---------------------------------------------------------------------- 78 */
var s78 = Sql.leerSecciones78(script('78_analisis_secciones.sql'));
Check('78: todas las tuplas leidas', s78.tuplas, s78.length);
Check('78: sin claves repetidas', s78.length, new Set(s78.map(function (x) { return x.clave; })).size);
SERVICIOS.forEach(function (e) {
  var f = s78.filter(function (x) { return x.clave === e.clave; });
  Check('78: ' + e.clave + ' una vez', 1, f.length);
  Check('78: ' + e.clave + ' sin nada prendido', 'null', f.length && String(f[0].secciones));
});
s78.forEach(function (x) {
  if (x.secciones == null) return;
  Ok('78: ' + x.clave + ' se lee', JSON.stringify(Motor.leerSecciones(x.secciones)) !== JSON.stringify(Motor.leerSecciones(null)), x.secciones);
});
// usp_Analisis_Datos manda ISNULL(Secciones, '{}'): apagado igual que sin la fila.
Check("Secciones '{}' apaga todo", JSON.stringify(Motor.leerSecciones(null)), JSON.stringify(Motor.leerSecciones('{}')));

/* -------------------------------------------- tickets de ejemplo y su regla */
var COLS = ['CodigoTicket', 'Origen', 'Tipo', 'Categoria', 'Estado', 'Subestado', 'Prioridad', 'SLA', 'TipoRelacion', 'Grupo',
            'TipoSitio', 'SitioNumero', 'Tienda', 'FechaRegistro', 'FechaEstimadaResolucion', 'FechaFirmaSolucion',
            'FechaFirmaCierre', 'FechaUltimaModificacion', 'IntentosSolucion', 'ReasignacionesGrupo',
            'Titulo', 'Descripcion', 'SolucionUsuario'];
function dos(n) { return (n < 10 ? '0' : '') + n; }
var INICIO = Date.UTC(2026, 6, 1);   // 2026-07-01, 61 dias
function dia(d, h) {
  var f = new Date(INICIO + d * 86400000);
  return f.getUTCFullYear() + '-' + dos(f.getUTCMonth() + 1) + '-' + dos(f.getUTCDate()) + ' ' + dos(h) + ':00:00';
}
// [titulo, descripcion, solucion, regla esperada]
var CASOS = {
  abasto: [
    ['Ampliacion', 'Solicito ampliación de vigencia de los pedidos', 'Se amplía', 'R11'],
    ['Pedido', 'Al ampliar marca tabla de bloqueo en SAP', 'Listo', 'R09'],                    // R09 gana a R11
    ['Presupuesto', 'Liberación de presupuesto comprometido', 'Listo', 'R04'],
    ['STO', 'Favor de cancelar las STO siguientes', 'Listo', 'R08'],
    ['Importacion', 'El pedido no migra a Infor Nexus', 'Listo', 'R12'],
    ['Bit', 'Retiro del bit de entrega final', 'Listo', 'R07'],
    ['Ampliacion', 'Solicito ampliacion de pedidos', 'Intentamos localizarlo sin tener éxito', 'R01'],  // la solucion gana
    ['Consulta', 'Hola buen dia', 'Listo', 'R99']
  ],
  conciliaciones: [
    ['Cierre', 'No deja hacer el cierre de backoffice, cajero activo', 'Listo', 'R12'],
    ['Diferencia', 'Marca diferencia en la conciliación de tarjetas', 'Listo', 'R14'],
    ['Cierre', 'No puedo cerrar el dia', 'Listo', 'R16'],
    ['Acceso', 'Usuario bloqueado, no puedo ingresar', 'Listo', 'R18'],
    ['Servicios', 'El pago de servicios no se refleja', 'Listo', 'R08'],
    ['Banco', 'El servidor bancario eHUB no agrega pagos', 'Listo', 'R06'],
    ['Cierre', 'No deja cerrar', 'Favor de escribir a Control de Ingresos', 'R04'],          // la solucion gana
    ['Cierre', 'No deja cerrar', 'No hemos podido contactar a la tienda', 'R01'],
    ['Consulta', 'Hola buen dia', 'Listo', 'R99']
  ]
};
// n tickets repartidos en 61 dias, mas "pico" tickets el 2026-07-15. Sin sitio:
// los pide una persona (asi llegan casi todos los de Abasto).
function tickets(clave, n, pico, conSitio) {
  var casos = CASOS[clave], filas = [];
  for (var i = 0; i < n + pico; i++) {
    var c = casos[i % casos.length], enPico = i >= n, sitio = conSitio && i % 2 === 0;
    filas.push({
      CodigoTicket: 'REQ 2026-' + (200000 + i), Origen: 'Categoria', Tipo: 'Peticion', Categoria: '/' + clave + '/Prueba',
      Estado: 'Cerrada', Subestado: '', Prioridad: 'Media', SLA: 'Estandar', TipoRelacion: '', Grupo: 'Mesa',
      TipoSitio: sitio ? 'Tienda' : 'Persona u otro', SitioNumero: sitio ? String(1000 + (i % 23)) : null,
      Tienda: sitio ? (1000 + (i % 23)) + ' Monterrey' : '(persona o cuenta)',
      FechaRegistro: enPico ? dia(14, 10) : dia(i % 61, 9 + (i % 8)),
      FechaEstimadaResolucion: enPico ? dia(14, 20) : dia(i % 61, 20),
      FechaFirmaSolucion: enPico ? dia(14, 18) : dia(i % 61, 18), FechaFirmaCierre: enPico ? dia(14, 19) : dia(i % 61, 19),
      FechaUltimaModificacion: '2026-09-01 08:00:00', IntentosSolucion: '1', ReasignacionesGrupo: '0',
      Titulo: c[0], Descripcion: c[1], SolucionUsuario: c[2]
    });
  }
  return filas;
}
// La respuesta de analisis.ashx: parametros, reglas (Frases como texto JSON, igual
// que la columna) y tickets.
function respuesta(e, filas) {
  function bloque(columnas, f) { return { columnas: columnas, filas: f }; }
  return {
    servicio: e.clave, desde: '2026-07-01', hasta: '2026-08-31',
    bloques: {
      parametros: bloque(['Bloque', 'Clave', 'Valor'], [['0) Parametros', 'Servicio', e.nombre], ['0) Parametros', 'ServicioClave', e.clave],
                                                        ['0) Parametros', 'Secciones', '{}']]),
      reglas: bloque(['Orden', 'Regla', 'Motivo', 'Campo', 'Frases'], e.s.reglas.map(function (r) { return [String(r.orden), r.id, r.motivo, r.campo, r.frasesTexto]; })),
      tickets: bloque(COLS, filas.map(function (f) { return COLS.map(function (c) { return f[c]; }); }))
    }
  };
}
function cargar(e, filas) {
  var trabajo = new AnalisisTrabajo(Motor);
  var c = trabajo.cargar(new TextEncoder().encode(JSON.stringify(respuesta(e, filas))).buffer, function () {});
  var sec = Motor.leerSecciones('{}');
  var a = trabajo.analizar({ nombre: e.nombre, reglas: c.reglas, motivosEquipo: [], secciones: { quincena: sec.quincena }, cedis: sec.cedis }, function () {});
  return { carga: c, res: a.resultado };
}
function picoHallazgo(res) { return res.hallazgos.filter(function (h) { return /día\(s\) pico/.test(h); })[0]; }
function sinRaros(res) {
  var malos = [];
  (function ver(v, donde) {
    if (typeof v === 'number' && !isFinite(v)) malos.push(donde);
    else if (typeof v === 'string' && /NaN|Infinity/.test(v)) malos.push(donde + '="' + v + '"');
    else if (v && typeof v === 'object') Object.keys(v).forEach(function (k) { ver(v[k], donde + '.' + k); });
  })({ hojas: res.hojas, hallazgos: res.hallazgos, graficas: res.graficas, cifras: res.cifras }, 'res');
  return malos;
}

SERVICIOS.forEach(function (e) {
  var n = e.clave + ': ';
  var x = cargar(e, tickets(e.clave, 183, 0, false));
  Check(n + 'la pestaña carga las reglas', e.reglas, x.carga.reglas.length);
  Check(n + 'reglas cargadas = las del .sql', JSON.stringify(e.reglasMotor), JSON.stringify(x.carga.reglas));
  // Cada caso de ejemplo con su regla.
  CASOS[e.clave].forEach(function (c) {
    var r = Motor.clasificar({ titulo: c[0], descripcion: c[1], solucion: c[2] }, x.carga.reglas);
    Check(n + JSON.stringify(c[1]) + ' / ' + JSON.stringify(c[2]) + ' -> ' + c[3], c[3], r.regla);
  });
  // El analisis completo: la hoja Reglas trae todas, mas R99.
  var reglasT = x.res.hojas.Reglas.filter(function (t) { return t.id === 'reglas'; })[0];
  Check(n + 'hoja Reglas: todas mas Sin clasificar', e.reglas + 1, reglasT.filas.length);
  Check(n + 'los motivos no se repiten en el resumen', x.res.cifras.motivos.length, new Set(x.res.cifras.motivos.map(function (m) { return m[0]; })).size);
  Check(n + 'sin NaN ni Infinity', '', sinRaros(x.res).join(', '));
  Check(n + 'sin quincena', 'null', String(x.res.graficas.quincena));

  // Editar reglas: de texto y de vuelta, las mismas reglas.
  var ida = Motor.textoAReglas(Motor.reglasATexto(x.carga.reglas));
  Check(n + 'editar reglas: sin errores', '', ida.errores.join('; '));
  Check(n + 'editar reglas: ida y vuelta igual', JSON.stringify(x.carga.reglas), JSON.stringify(ida.reglas));

  // Dia pico sin sitios: dice el dia y los tickets, nunca "de 0 sitios".
  var sin = cargar(e, tickets(e.clave, 183, 40, false)).res;
  Check(n + 'sin sitios: pocosSitios', true, sin.cifras.pocosSitios);
  var hs = picoHallazgo(sin);
  Ok(n + 'sin sitios: hay hallazgo del pico', !!hs, sin.hallazgos.join(' / '));
  Ok(n + 'sin sitios: el pico no dice de cuantos sitios', hs && !/sitios/.test(hs) && /tickets\.$/.test(hs), hs);
  Ok(n + 'sin sitios: ningun hallazgo dice "0 sitios"', !sin.hallazgos.some(function (h) { return /\b0 sitios/.test(h); }), sin.hallazgos.join(' / '));
  Ok(n + 'sin sitios: dice por que no mide por sitio', sin.hallazgos.some(function (h) { return /no se mide por sitio/.test(h); }), sin.hallazgos.join(' / '));

  // El mismo pico con sitio en la mitad: sigue diciendo de cuantos sitios.
  var con = cargar(e, tickets(e.clave, 183, 40, true)).res;
  Check(n + 'con sitios: no es pocosSitios', false, con.cifras.pocosSitios);
  var hc = picoHallazgo(con);
  Ok(n + 'con sitios: el pico dice de cuantos sitios', hc && /tickets de [1-9]\d* sitios\.$/.test(hc), hc);
  Check(n + 'con sitios: el mismo dia pico', hs && hs.split(',')[1], hc && hc.split(',')[1]);
  e.res = sin; e.resCon = con;
});

/* ------------------------------------------------------------------ Excel */
(async function () {
  async function libro(res) {
    var buf = await Motor.armarLibro(res, ExcelJS).xlsx.writeBuffer();
    var wb = new ExcelJS.Workbook(); await wb.xlsx.load(buf);
    var out = {};
    wb.eachSheet(function (ws) { var t = []; ws.eachRow(function (r) { r.eachCell(function (cl) { t.push(String(cl.value)); }); }); out[ws.name] = t.join('\n'); });
    return out;
  }
  for (var i = 0; i < SERVICIOS.length; i++) {
    var e = SERVICIOS[i], n = e.clave + ': ', x = await libro(e.res), xc = await libro(e.resCon);
    Ok(n + 'Excel: hoja Reglas con la ultima regla', x.Reglas && x.Reglas.indexOf(e.s.reglas[e.s.reglas.length - 1].motivo) >= 0, 'falta');
    Ok(n + 'Excel: Resumen sin "0 sitios"', !/\b0 sitios/.test(x.Resumen), 'aparece');
    Ok(n + 'Excel: Sitios explica el corte', /menos del 30%/.test(x.Sitios), (x.Sitios || '').slice(0, 200));
    Ok(n + 'Excel con sitios: Concentración', /Concentración/.test(xc.Sitios), 'falta');
    Ok(n + 'Excel: sin NaN ni Infinity', !/NaN|Infinity/.test(JSON.stringify([x, xc])), 'aparece');
  }
  console.log(fallos ? '\n' + fallos + ' caso(s) fallaron' : '\nTodo paso');
  process.exit(fallos ? 1 : 0);
})().catch(function (e) { console.log('FAIL  excepcion: ' + (e && e.stack || e)); process.exit(1); });
