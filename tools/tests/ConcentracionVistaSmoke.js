// tools/tests/ConcentracionVistaSmoke.js - prueba de humo de la parte PURA de
// concentracion/concentracion.js (window.ConcentracionDatos).
//
// NO forma parte del sitio. Carga el ARCHIVO REAL en un contexto sin
// `document`, asi que solo corre la parte 1 (sin DOM).
//
//   T  Top 10 / 15: se recorta para pintar, pero el total, el numero de filas
//      y la marca del 80 % son de la lista COMPLETA.
//   O  80 %: la fila que cruza cuenta dentro; la siguiente ya no; sin
//      acumulado no se adivina.
//   E  etiquetas: Pareto con NombreServicio (82) o sin el (actual), rutas
//      de categoria largas abreviadas a los dos ultimos niveles con el
//      nombre completo intacto para el tooltip.
//   L  eje de las horizontales en dos lineas de 26 caracteres.
//   K  aviso de cobertura parcial del Slot (texto del dato del servidor).
//   P  periodo del servidor -> texto, sin pasar por Date.
//   S  Slot escrito a mano: acotado a 0..12, basura = null.
//   V  vacio / fallo: [] es "sin tickets", null es "fallo"; vacio por filtros o por periodo.
//   F  filtros -> query string (solo el parametro del modo elegido).
//   A  texto de lo aplicado (periodo con fechas, SO, Grupo, tickets).
//
//   node tools\tests\ConcentracionVistaSmoke.js   # PASS/FAIL por caso, sale 0 si todo paso
'use strict';
var fs = require('fs');
var path = require('path');
var vm = require('vm');

var codigo = fs.readFileSync(path.join(__dirname, '..', '..', 'concentracion', 'concentracion.js'), 'utf8');
var ctx = { window: {}, Intl: Intl };
vm.createContext(ctx);
vm.runInContext(codigo, ctx);
var D = ctx.window.ConcentracionDatos;

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

// Lista como la del SP: Posicion, cantidad descendente, acumulado creciente.
function lista(etiqueta, cantidades, total) {
  var acum = 0;
  return cantidades.map(function (c, i) {
    acum += c;
    var f = { Posicion: i + 1, CantidadTickets: c, TotalTickets: total,
              Porcentaje: Math.round(10000 * c / total) / 100,
              PorcentajeAcumulado: Math.round(10000 * acum / total) / 100 };
    f[etiqueta] = etiqueta + ' ' + (i + 1);
    return f;
  });
}

// ---- T: Top
var grupos = lista('Grupo', [50, 40, 30, 20, 10, 9, 8, 7, 6, 5, 4, 3, 2, 2, 1, 1, 1, 1], 200);
var vg = D.vista('grupos', grupos);
Check('T1 grupos: pinta 15', 15, vg.filas.length);
Check('T2 grupos: cuenta las 18', 18, vg.cuantas);
Check('T3 grupos: total del SP, no la suma del Top', 200, vg.total);
Check('T4 grupos: resumen', 'Top 15 de 18 grupos · 200 tickets', D.resumen('grupos', vg));
var pareto = lista('Servicio', [30, 20, 15, 10, 8, 6, 4, 3, 2, 1, 1], 100);
var vp = D.vista('pareto', pareto);
Check('T5 pareto: pinta 10', 10, vp.filas.length);
Check('T6 pareto: acumulado tal cual del SP', [30, 50, 65, 75, 83, 89, 93, 96, 98, 99], vp.acumulado);
var pocas = lista('Categoria', [3, 2], 5);
Check('T7 menos filas que el Top: sin "Top"', '2 categorías · 5 tickets', D.resumen('categorias', D.vista('categorias', pocas)));
Check('T8 Top de cada grafica', { pareto: 10, categorias: 15, grupos: 15 }, D.TOP);

// ---- O: 80 %
// pareto acumulado: 30 50 65 75 83 89 ... -> dentro: 30,50,65,75 y 83 (cruza); 89 no.
Check('O1 la que cruza el 80 % cuenta dentro, la siguiente no',
  [true, true, true, true, true, false, false, false, false, false], vp.dentro);
Check('O2 marca sobre la lista completa (antes de recortar)',
  D.marcarDentro(pareto).length, pareto.length);
Check('O3 exactamente 80 en la fila anterior: ya fuera', [true, true, false],
  D.marcarDentro([{ PorcentajeAcumulado: 50 }, { PorcentajeAcumulado: 80 }, { PorcentajeAcumulado: 90 }]));
Check('O4 sin acumulado no se adivina', [false, true],
  D.marcarDentro([{ PorcentajeAcumulado: null }, { PorcentajeAcumulado: 40 }]));
// El caso real de QA (diag 2, slot 0): grupos cruza en la fila 15 (80.69).
var acumQa = [13.55, 26.49, 36.07, 43.48, 50.76, 55.38, 59.57, 62.88, 65.97, 68.91, 71.63, 74.17, 76.61, 78.72, 80.69, 82.59];
Check('O5 QA grupos slot 0: 15 dentro, la 16 fuera',
  15, D.marcarDentro(acumQa.map(function (a) { return { PorcentajeAcumulado: a }; })).filter(Boolean).length);

// ---- E: etiquetas
Check('E1 pareto actual (rama)', 'S-Equipo de Computo', D.etiquetaFila('pareto', { Servicio: 'S-Equipo de Computo' }));
Check('E2 pareto con 82 (NombreServicio)', 'Fenix WMS / Logistica',
  D.etiquetaFila('pareto', { Servicio: 'WMS', NombreServicio: 'Fenix WMS / Logistica' }));
Check('E3 NombreServicio vacio -> Servicio', 'WMS', D.etiquetaFila('pareto', { Servicio: 'WMS', NombreServicio: ' ' }));
Check('E4 categoria: dos ultimos niveles',
  'Falla en sistema de biométrico › Usuario no encontrado'.slice(0, 43) + '…',
  D.abreviarRuta('/S-Biométrico/Falla en sistema de biométrico/Usuario no encontrado'));
Check('E5 categoria corta: entera', 'S-Basculas › Hardware', D.abreviarRuta('/S-Basculas/Hardware'));
Check('E6 abreviada nunca pasa del largo', true,
  D.abreviarRuta('/A/' + 'x'.repeat(80) + '/' + 'y'.repeat(80)).length <= D.LARGO_ETIQUETA);
var largas = [{ Posicion: 1, Categoria: '/S-Logistica/FENIX WMS - RECIBO PROVEEDORES/CITA NO REPLICA', CantidadTickets: 1,
                TotalTickets: 1, Porcentaje: 100, PorcentajeAcumulado: 100 }];
var vl = D.vista('categorias', largas);
Check('E7 tooltip con la ruta completa', '/S-Logistica/FENIX WMS - RECIBO PROVEEDORES/CITA NO REPLICA', vl.etiquetas[0]);
Check('E8 eje con la abreviada (44 caracteres)', ['FENIX WMS - RECIBO PROVEEDORES › CITA NO RE…', 44], [vl.cortas[0], vl.cortas[0].length]);
Check('E9 grupo largo recortado en el eje, completo en tooltip',
  [D.LARGO_ETIQUETA, 'G'.repeat(60)],
  (function () { var v = D.vista('grupos', [{ Grupo: 'G'.repeat(60), PorcentajeAcumulado: 100, TotalTickets: 1 }]);
                 return [v.cortas[0].length, v.etiquetas[0]]; })());
Check('E10 NULL no es vacio', ['(sin valor)', '(vacío)'],
  [D.etiquetaFila('grupos', { Grupo: null }), D.etiquetaFila('grupos', { Grupo: '  ' })]);

// ---- L: eje en dos lineas (Chart.js recorta por la izquierda lo que no cabe)
Check('L1 corta: una linea', 'Service Desk', D.lineasEje('Service Desk'));
Check('L2 larga: dos lineas por palabras', ['Soporte Especializado en', 'Aplicativos Inetum'], D.lineasEje('Soporte Especializado en Aplicativos Inetum'));
Check('L3 no cabe en dos: la segunda termina en …', ['Nivel intermedio con', 'nombre largo 0 › Detalle…'],
  D.lineasEje('Nivel intermedio con nombre largo 0 › Detalle final de la categoria'));
Check('L4 ninguna linea pasa de 26', true, [].concat(D.lineasEje('x'.repeat(70) + ' y z')).every(function (l) { return l.length <= 26; }));

// ---- K: cobertura del Slot (la decide el servidor; aqui solo el texto)
Check('K1 sin medir (null) o completa: sin aviso', ['', ''],
  [D.textoCobertura(null), D.textoCobertura({ completa: true, diasConTickets: 30, diasEsperados: 30 })]);
Check('K2 Slot 11 de QA: 16 de 30 dias, con el rango real',
  'Cobertura parcial: hay tickets en 16 de 30 días del periodo · datos del 19/11/2025 al 14/12/2025.',
  D.textoCobertura({ completa: false, diasConTickets: 16, diasEsperados: 30, primerDia: '2025-11-19', ultimoDia: '2025-12-14', excluyeHoy: false }));
Check('K3 Slot 0: dice que no cuenta hoy',
  'Cobertura parcial: hay tickets en 20 de 29 días completos (sin contar hoy) · datos del 21/10/2026 al 09/11/2026.',
  D.textoCobertura({ completa: false, diasConTickets: 20, diasEsperados: 29, primerDia: '2026-10-21', ultimoDia: '2026-11-09', excluyeHoy: true }));
Check('K4 Slot sin tickets', 'Cobertura parcial: hay tickets en 0 de 30 días del periodo.',
  D.textoCobertura({ completa: false, diasConTickets: 0, diasEsperados: 30, primerDia: null, ultimoDia: null }));
Check('K5 datos raros: sin aviso (no se inventa)', '', D.textoCobertura({ completa: false }));

// ---- P: periodo
Check('P1 periodo del servidor', 'Del 11/10/2026 al 09/11/2026',
  D.textoPeriodo({ desde: '2026-10-11', hasta: '2026-11-09', dias: 30 }));
Check('P2 sin periodo, nada', '', D.textoPeriodo(null));

// ---- S: Slot
Check('S1 0..12', [0, 5, 12], [D.acotarSlot('0'), D.acotarSlot(' 5 '), D.acotarSlot('12')]);
Check('S2 fuera de rango se acota', [12, 12], [D.acotarSlot('13'), D.acotarSlot('999')]);
Check('S3 basura = null', [null, null, null, null], [D.acotarSlot(''), D.acotarSlot('-1'), D.acotarSlot('2.5'), D.acotarSlot('dos')]);
Check('S4 respeta el maximo del servidor', 6, D.acotarSlot('9', 6));

// ---- V: vacio y fallo
Check('V1 null = fallo', null, D.vista('pareto', null));
var vacia = D.vista('pareto', []);
Check('V2 [] = sin tickets', [0, 0, null, ''], [vacia.filas.length, vacia.cuantas, vacia.total, D.resumen('pareto', vacia)]);
Check('V3 vacio por filtros vs periodo vacio', ['Sin tickets con estos filtros.', 'Sin tickets en este periodo.', 'Sin tickets en este periodo.'],
  [D.mensajeVacio({ ticketsPeriodo: 12 }), D.mensajeVacio({ ticketsPeriodo: 0 }), D.mensajeVacio(null)]);

// ---- F: filtros -> consulta (solo viaja el parametro del modo elegido)
Check('F1 slot por omision', 'modo=slot&slot=0', D.consulta({ modo: 'slot', slot: 0, mes: '2026-10', so: [], grupo: [] }));
Check('F2 mes: no manda slot', 'modo=mes&mes=2026-10', D.consulta({ modo: 'mes', slot: 4, mes: '2026-10', so: [], grupo: [] }));
Check('F3 mes sin elegir todavia: el servidor da el actual', 'modo=mes', D.consulta({ modo: 'mes', slot: 0, mes: null, so: [], grupo: [] }));
Check('F4 SO y Grupo por "|", codificados (nombres con coma)',
  'modo=slot&slot=2&so=' + encodeURIComponent('Pérez, Ana|(Sin Service Owner)') + '&grupo=' + encodeURIComponent('Service Desk'),
  D.consulta({ modo: 'slot', slot: 2, so: ['Pérez, Ana', '(Sin Service Owner)'], grupo: ['Service Desk'] }));

// ---- A: lo aplicado, como lo confirma el servidor
var base = { modo: 'slot', slot: 0, periodo: { desde: '2026-10-11', hasta: '2026-11-09' }, ticketsPeriodo: 11492, ticketsFiltrados: 11492,
             filtros: { serviceOwners: [], grupos: [] }, meses: [] };
Check('A1 sin filtros', 'Periodo: Slot 0 · del 11/10/2026 al 09/11/2026 · Service Owner: todos · Grupo: todos · 11,492 tickets en el periodo',
  D.textoActivos(base));
Check('A2 mes en curso con filtros',
  'Periodo: Mes Noviembre 2026 (en curso, hasta hoy) · del 01/11/2026 al 09/11/2026 · Service Owner: Ana · Grupo: G1, G2, G3 y 1 más · 120 de 3,000 tickets del periodo',
  D.textoActivos({ modo: 'mes', mes: '2026-11', periodo: { desde: '2026-11-01', hasta: '2026-11-09' }, ticketsPeriodo: 3000, ticketsFiltrados: 120,
    filtros: { serviceOwners: ['Ana'], grupos: ['G1', 'G2', 'G3', 'G4'] }, meses: [{ valor: '2026-11', etiqueta: 'Noviembre 2026', enCurso: true }] }));
Check('A3 sin respuesta, nada', '', D.textoActivos(null));

console.log(fallos ? fallos + ' FALLARON' : 'TODO PASA');
process.exit(fallos ? 1 : 0);
