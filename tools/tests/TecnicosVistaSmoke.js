// tools/tests/TecnicosVistaSmoke.js - prueba de humo de la vista Tecnicos.
//
// NO forma parte del sitio: vive fuera de assets/, asi que ni IIS ni el
// navegador lo cargan nunca.
//
// Carga el tecnicos/tecnicos.js REAL con un `window` de mentira y SIN
// document: la parte pura (window.TecnicosDatos) se publica y la del tablero
// se corta sola. Comprueba:
//   - formato de numeros y porcentajes, con NULL como "—" y nunca como 0;
//   - rango de fechas: default de 15 dias, validacion (vacio, invertido,
//     formato, tope de 93 dias) y que la consulta lleva SIEMPRE las dos;
//   - KPIs, barra y tabla por tecnico con los campos del SP, sin calcular;
//   - evidencia: busqueda, estado, tecnico y paginacion sobre lo recibido;
//   - que el modulo no deduce CALIDAD de nombres de clasificacion;
//   - el cableado: dashboard.html / dashboard.js, ids de tecnicos.js en
//     tecnicos.html, y que QA y QARE no conocen a Tecnicos (ni al reves).
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\TecnicosVistaSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
// Fin de linea normalizado: con autocrlf el checkout puede traer CRLF.
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8').replace(/\r\n/g, '\n'); }

var ventana = {};
var fuente = leer('tecnicos/tecnicos.js');
(new Function('window', fuente))(ventana);
var T = ventana.TecnicosDatos;

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + '  esperado=' + e + '  obtenido=' + o);
}

// --- sin document, la parte del tablero no arranca -----------------------
Check('TecnicosDatos publicado', 'object', typeof T);
Check('sin document no hay modulo de tablero', 'undefined', typeof ventana.TableroTecnicosModulo);

// --- numeros, porcentajes y nulos -----------------------------------------
Check('numero(null) sigue null', null, T.numero(null));
Check('numero("") es null', null, T.numero(''));
Check('numero(0) es 0', 0, T.numero(0));
Check('entero null -> —', '—', T.entero(null));
Check('entero con miles', '9,444', T.entero(9444));
Check('pct del SP con dos decimales', '48.61 %', T.pct(48.61));
Check('pct 0 se ve como 0, no como nulo', '0.00 %', T.pct(0));
Check('pct NULL -> —', '—', T.pct(null));
Check('pct texto decimal de SQL', '38.43 %', T.pct('38.43'));

// --- fechas ------------------------------------------------------------------
// 2026-11-27 12:00 hora de Mexico = 18:00 UTC.
var ahora = Date.parse('2026-11-27T18:00:00Z');
Check('15 dias terminan hoy (Mexico)', { inicio: '2026-11-13', fin: '2026-11-27' }, T.rangoRapido(15, ahora));
Check('a las 23:30 de Mexico sigue siendo hoy', '2026-11-27', T.rangoRapido(1, Date.parse('2026-11-28T05:30:00Z')).fin);
Check('rango valido', null, T.validarRango('2026-11-13', '2026-11-27'));
Check('un solo dia es valido', null, T.validarRango('2026-11-27', '2026-11-27'));
Check('inicio > fin se rechaza', true, /anterior o igual/.test(T.validarRango('2026-11-28', '2026-11-27')));
Check('fecha vacia se rechaza', true, /Elige/.test(T.validarRango('', '2026-11-27')));
Check('formato invalido se rechaza', true, /aaaa-mm-dd/.test(T.validarRango('27/11/2026', '2026-11-27')));
Check('93 dias es el tope y vale', null, T.validarRango('2026-08-27', '2026-11-27'));
Check('94 dias se rechaza', true, /maximo/.test(T.validarRango('2026-08-26', '2026-11-27')));
Check('la consulta lleva SIEMPRE las dos fechas', 'fecha_inicio=2026-11-13&fecha_fin=2026-11-27', T.consulta('2026-11-13', '2026-11-27'));

// --- KPIs (usp_QARE_CalidadCaptura_KPIs, cifras de la captura de Daniela) ----
var kpis = { TicketsTotales: 8304, TicketsSinInformacionQARE: 1588, TicketsEvaluados: 6716,
  TicketsNoEvaluables: 2581, PctNoEvaluable: 38.43, TicketsTextoEvaluable: 4135, PctTextoEvaluable: 61.57 };
var t = T.tarjetasKpi(kpis);
Check('cuatro tarjetas en orden', ['Total de tickets', 'Sin información QARE', 'Respuestas analizables', 'Respuestas inválidas'],
  t.map(function (x) { return x.titulo; }));
Check('valores tal cual del SP', ['8,304', '1,588', '4,135', '2,581'], t.map(function (x) { return x.valor; }));
Check('pie con el % del SP', '61.57 % de los evaluados', t[2].pie);
Check('pie de invalidas con su %', '38.43 % de los evaluados', t[3].pie);
var tNulo = T.tarjetasKpi({ TicketsTotales: 0, TicketsSinInformacionQARE: 0, TicketsNoEvaluables: 0, PctNoEvaluable: null,
  TicketsTextoEvaluable: 0, PctTextoEvaluable: null });
Check('rango vacio: % NULL -> —', '— de los evaluados', tNulo[3].pie);
Check('rango vacio: total 0', '0', tNulo[0].valor);
Check('sin KPIs (bloque fallido) todo en —', ['—', '—', '—', '—'], T.tarjetasKpi(null).map(function (x) { return x.valor; }));

// --- barra (result set 3) ------------------------------------------------------
var resumen = { TotalTextoEvaluable: 4135, TicketsConPatron: 2010, PctConPatron: 48.61, TicketsCalidad: 435,
  PctCalidad: 10.52, TicketsSinPatron: 1690, PctSinPatron: 40.87 };
var s = T.segmentos(resumen);
Check('tres segmentos en orden', ['patron', 'calidad', 'sin'], s.map(function (x) { return x.clave; }));
Check('anchos = Pct del SP, sin normalizar', [48.61, 10.52, 40.87], s.map(function (x) { return x.ancho; }));
Check('leyenda con el % del SP', ['48.61 %', '10.52 %', '40.87 %'], s.map(function (x) { return x.pct; }));
Check('leyenda con los tickets del SP', ['2,010', '435', '1,690'], s.map(function (x) { return x.tickets; }));
var sNulo = T.segmentos({ TotalTextoEvaluable: 0, TicketsConPatron: 0, PctConPatron: null, TicketsCalidad: 0,
  PctCalidad: null, TicketsSinPatron: 0, PctSinPatron: null });
Check('Pct NULL: ancho 0 y leyenda —', [0, '—'], [sNulo[0].ancho, sNulo[0].pct]);
Check('un % fuera de escala no rompe la barra', 100, T.segmentos({ PctConPatron: 140 })[0].ancho);

// --- tabla por tecnico ----------------------------------------------------------
var fila = { FirmaSolucion: 'Tecnico A', TicketsTotales: 155, TicketsSinInformacionQARE: 0, TicketsEvaluados: 155,
  TicketsNoEvaluables: 155, PctNoEvaluable: 100, TicketsTextoEvaluable: 0, PctTextoEvaluable: 0,
  TicketsConPatron: 0, PctConPatron: null, TicketsCalidad: 0, PctCalidad: null, TicketsSinPatron: 0, PctSinPatron: null };
var c = T.celdasTecnico(fila);
Check('firma + 7 metricas', 8, c.length);
Check('firma tal cual', 'Tecnico A', c[0].valor);
Check('invalidas con su %', ['155', '100.00 %'], [c[3].valor, c[3].pct]);
Check('patron con % NULL (sin texto evaluable) -> —', ['0', '—'], [c[5].valor, c[5].pct]);
Check('firma NULL rotulada, no vacia', '(sin firma)', T.celdasTecnico({ FirmaSolucion: null })[0].valor);
Check('las cinco metricas resaltadas estan', true,
  ['TicketsNoEvaluables', 'TicketsTextoEvaluable', 'TicketsConPatron', 'TicketsCalidad', 'TicketsSinPatron']
    .every(function (k) { return T.COLUMNAS_TECNICOS.some(function (col) { return col[2] === k; }); }));

// --- evidencia: busqueda, estado, tecnico, paginacion ----------------------------
var det = [];
for (var i = 1; i <= 60; i++) {
  det.push({
    CodigoTicket: 'INC ' + i,
    FirmaSolucion: i % 3 === 0 ? 'Pérez, Ana' : 'Soto, Luis',
    EstadoDescripcionVisual: i % 4 === 0 ? 'RESPUESTA INVALIDA' : (i % 5 === 0 ? 'SIN INFORMACION QARE' : 'RESPUESTA ANALIZABLE'),
    QARe_DescripcionSolucion: i === 7 ? 'Se reinició el servicio de la báscula' : 'texto ' + i,
    ClasificacionRespuesta: null, Grupo: 'Mesa', Categoria: 'Cat',
  });
}
Check('estados en orden de aparicion', ['RESPUESTA ANALIZABLE', 'RESPUESTA INVALIDA', 'SIN INFORMACION QARE'], T.estadosDe(det));
Check('sin filtro: todas', 60, T.filtrarDetalle(det, {}).length);
Check('estado exacto', 15, T.filtrarDetalle(det, { estado: 'RESPUESTA INVALIDA' }).length);
Check('busqueda sin acentos ni mayusculas', ['INC 7'], T.filtrarDetalle(det, { buscar: 'REINICIO' }).map(function (f) { return f.CodigoTicket; }));
Check('busqueda acento-insensible', ['INC 7'], T.filtrarDetalle(det, { buscar: 'reinicio el SERVICIO' }).map(function (f) { return f.CodigoTicket; }));
Check('busqueda por ticket', ['INC 42'], T.filtrarDetalle(det, { buscar: 'inc 42' }).map(function (f) { return f.CodigoTicket; }));
Check('tecnico exacto', 20, T.filtrarDetalle(det, { firma: 'Pérez, Ana' }).length);
Check('tecnico + estado', 5, T.filtrarDetalle(det, { firma: 'Pérez, Ana', estado: 'RESPUESTA INVALIDA' }).length);
Check('busqueda que no coincide', 0, T.filtrarDetalle(det, { buscar: 'zzz' }).length);
var p1 = T.paginar(det, 1, 25);
Check('pagina 1 de 3', [1, 3, 1, 25, 60], [p1.pagina, p1.paginas, p1.desde, p1.hasta, p1.total]);
var p3 = T.paginar(det, 3, 25);
Check('ultima pagina incompleta', [3, 51, 60, 10], [p3.pagina, p3.desde, p3.hasta, p3.filas.length]);
Check('pagina fuera de rango se acota', 3, T.paginar(det, 99, 25).pagina);
Check('pagina 0 se acota a 1', 1, T.paginar(det, 0, 25).pagina);
var p0 = T.paginar([], 1, 25);
Check('sin filas: 0 de 0, una pagina', [0, 0, 1, 0], [p0.desde, p0.total, p0.paginas, p0.filas.length]);
Check('paginar no toca el arreglo original', 60, det.length);

// --- estados y tipo: solo etiquetas del SP, sin clasificar -----------------------
Check('clase de las tres etiquetas del SP', ['ana', 'inv', 'sin', ''],
  ['RESPUESTA ANALIZABLE', 'RESPUESTA INVALIDA', 'SIN INFORMACION QARE', 'OTRA'].map(T.claseEstado));
Check('clase de TipoClasificacionRespuesta', ['patron', 'calidad', 'sin', ''],
  ['PATRON_SOLUCION', 'CALIDAD', 'SIN PATRON', null].map(T.claseTipo));
Check('tecnicos.js no deduce CALIDAD de nombres de clasificacion', false,
  /PROBLEMA \/ NO SOLUCION|RESPUESTA SIN ACCION DOCUMENTADA/.test(fuente));
Check('la columna de tipo depende de detalleTraeTipo', true, /detalleTraeTipo === true/.test(fuente));
Check('tecnicos.js no recalcula porcentajes (sin / TicketsT...)', false, /\/\s*numero\(.*Tickets/.test(fuente));

// --- formato de fecha -------------------------------------------------------------
Check('fecha ISO a corta', '2026-11-26 15:39', T.fechaHora('2026-11-26T15:39:42'));
Check('fecha nula a vacio', '', T.fechaHora(null));

// --- cableado ---------------------------------------------------------------------
var html = leer('dashboard.html');
var js = leer('dashboard.js');
var pagina = leer('tecnicos/tecnicos.html');
Check('boton del selector de Calidad', true, /id="snav-tecnicos" data-tab="tecnicos"[^>]*>Técnicos</.test(html));
Check('contenedor propio rotulado por su boton', true, /id="tab-tecnicos" class="maintab-content"[^>]*aria-labelledby="snav-tecnicos"/.test(html));
Check('MODULOS registra tecnicos', true, /\n  tecnicos: TableroTecnicos,\n/.test(js));
Check('GRUPOS.calidad incluye tecnicos', true, /calidad: \['qa', 'qare', 'tecnicos'\]/.test(js));
Check('moduloEmbebido con sus archivos', true,
  /moduloEmbebido\(\{\s*nombre: 'Técnicos',\s*base: 'tecnicos\/',\s*id: 'tab-tecnicos',\s*pagina: 'tecnicos\.html',\s*hoja: 'tecnicos\.css',\s*guion: 'tecnicos\.js'/.test(js));
Check('refresco automatico cableado', true, /refrescoDe\('TableroTecnicosModulo'\)/.test(js));
Check('la pagina trae su envoltorio #tab-tecnicos', true, /<div id="tab-tecnicos" class="maintab-content active">/.test(pagina));

var ids = {};
(fuente.match(/\$\('([a-z0-9-]+)'\)/g) || []).forEach(function (m) { ids[m.slice(3, -2)] = true; });
['msg-barra', 'msg-pareto'].forEach(function (k) { ids[k] = true; });
var faltan = Object.keys(ids).filter(function (id) { return pagina.indexOf('id="tec-' + id + '"') === -1; });
Check('cada id que pide tecnicos.js existe en tecnicos.html', [], faltan);

Check('tecnicos.js solo habla con tecnicos.ashx', ['tecnicos.ashx'],
  (fuente.match(/[a-z_]+\.ashx/g) || []).filter(function (v, i, a) { return a.indexOf(v) === i; }));
Check('QARE no conoce a Tecnicos', false, /tecnicos/i.test(leer('qare/qare.js')) || /tecnicos/i.test(leer('handlers/qare.ashx')));
Check('QA no conoce a Tecnicos', false, /tecnicos\.ashx|TableroTecnicos/.test(leer('qa/qa.js')));
Check('Tecnicos no usa el contrato de QARE', false,
  /QareContrato\.|QareQueries\.|QareBloque/.test(leer('App_Code/TecnicosQueries.cs') + leer('App_Code/TecnicosContrato.cs') + leer('handlers/tecnicos.ashx')));

console.log('');
console.log(fallos === 0 ? 'TODO OK' : fallos + ' FALLOS');
process.exit(fallos === 0 ? 0 : 1);
