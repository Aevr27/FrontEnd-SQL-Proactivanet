// tools/tests/RegistroIniciativasSmoke.js - prueba de humo del registro de
// iniciativas (vista Iniciativas de admin/iniciativas.html,
// admin/registro-iniciativas.js) sobre un DOM de mentira y un `pedir` propio.
//
// NO forma parte del sitio: vive fuera de admin/.
//
// Partes:
//   D) Registro / FiltroRegistro sin DOM: indicadores con el criterio de
//      Experiencia, estados en orden, filtros, cascada progresiva Director ->
//      PO -> SO -> Categoria, sin categoria, orden.
//   V) La pagina completa: Iniciativas de inicio, el boton abre Nueva
//      solicitud y el borrador sobrevive con el registro cargado.
//   C) Carga: cargando, error 500, red caida, respuesta sin lista, registro
//      vacio, reintento; ninguno se ve como lista vacia.
//   L) Lista: filas, indicadores, filtros por select, estado vacio con
//      filtros, limpiar, orden por columna, "Mostrar mas".
//   E) Detalle: abre al elegir, categorias sin duplicar, secciones, Escape,
//      fondo y cambio de vista lo cierran.
//   S) Detalle: "Solicitar cambios" (borrador validado, sin envio ni
//      peticion al servidor) e "Historial de cambios (N)" plegado.
//   S2) Estado: varios a la vez, mismo control y reglas que Tipo
//      (SeleccionVarios): todos por omision, "Todos" alterna, ninguno =
//      lista vacia, O entre estados, Y con los demas filtros, Limpiar,
//      un solo panel abierto a la vez.
//   T) Tipo de iniciativa = catalogo dbo.CatPrefijoProblem (tipos_iniciativa)
//      contra el `prefijo` de cada iniciativa; NO tipo_iniciativa ni la
//      Agrupacion. Opciones = catalogo completo, todas marcadas por omision, uno, varios (O), ninguno = no
//      pasa nada, "Todas" alterna marcar todo / desmarcar todo, junto con
//      los demas filtros, Limpiar; el panel de casillas en el DOM.
//   La Agrupacion ya no es filtro (ni select ni FiltroRegistro).
//   B) Busqueda por folio o titulo: parcial, sin mayusculas, separadores,
//      ceros ni acentos; combinada con los demas filtros, sin tocar la
//      Cobertura; espera entre teclas, Enter, Limpiar y recarga en el DOM.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\RegistroIniciativasSmoke.js   # sale 0 si todo paso
//
'use strict';
var fs = require('fs');
var path = require('path');

var raiz = path.join(__dirname, '..', '..');
function leer(rel) { return fs.readFileSync(path.join(raiz, rel), 'utf8'); }

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}

// ---------------------------------------------------------------------------
// DOM de mentira (el mismo modelo que IniciativasCascadaSmoke.js)
// ---------------------------------------------------------------------------
function Elemento(id) {
  var oyentes = {}, clases = {}, atributos = {};
  return {
    id: id, textContent: '', hidden: false, innerHTML: '', value: '', disabled: false,
    className: '', style: {}, offsetWidth: 200, hijos: [], enfocado: 0,
    classList: {
      add: function (c) { clases[c] = true; },
      remove: function (c) { delete clases[c]; },
      toggle: function (c, v) { if (v) clases[c] = true; else delete clases[c]; },
      contains: function (c) { return !!clases[c]; }
    },
    setAttribute: function (k, v) { atributos[k] = String(v); },
    getAttribute: function (k) { return Object.prototype.hasOwnProperty.call(atributos, k) ? atributos[k] : null; },
    appendChild: function (h) { this.hijos.push(h); return h; },
    contains: function (otro) { return otro === this; },
    matches: function () { return false; },
    focus: function () { this.enfocado++; },
    getBoundingClientRect: function () { return { left: 100, width: 80, bottom: 50 }; },
    addEventListener: function (tipo, fn) { (oyentes[tipo] = oyentes[tipo] || []).push(fn); },
    disparar: function (tipo, evento) {
      var self = this;
      var e = evento || { target: self };
      (oyentes[tipo] || []).forEach(function (fn) { fn(e); });
    },
    opciones: function () {
      var salida = [], re = /<option value="([^"]*)">/g, m;
      while ((m = re.exec(this.innerHTML))) if (m[1] !== '') salida.push(m[1].replace(/&amp;/g, '&'));
      return salida;
    }
  };
}
function Documento() {
  var els = {};
  var doc = Elemento('document');
  doc.readyState = 'complete';
  doc.getElementById = function (id) { return els[id] || (els[id] = Elemento(id)); };
  doc.querySelectorAll = function () { return []; };
  doc.createElement = function () { return Elemento(''); };
  doc.body = Elemento('body');
  doc.documentElement = Elemento('html');
  return doc;
}
function Respuesta(status, cuerpo) {
  return {
    ok: status >= 200 && status < 300, status: status,
    json: function () {
      return typeof cuerpo === 'string' ? Promise.reject(new SyntaxError('no json')) : Promise.resolve(cuerpo);
    }
  };
}
function nunca() { return new Promise(function () {}); }
function esperar() { return new Promise(function (ok) { setTimeout(ok, 0); }); }

// ---------------------------------------------------------------------------
// Datos: la forma de handlers/admin_iniciativas_registro.ashx
// ---------------------------------------------------------------------------
function Ini(folio, o) {
  var i = {
    folio: folio, titulo: 'T ' + folio, titulo_problem: 'T ' + folio, agrup: 'Problem', estado: 'En Análisis',
    tickets_reduce: 0, vol_reduce_folio: 0, riesgo_folio: 0, retrazado: 0, sem_fecha: 'ambar',
    fecha_retrasada: false, f_analisis: '2026-12-01', f_solucion: null, f_cierre: null,
    n_analisis: 0, n_solucion: 0, n_cierre: 0, antiguedad: 10, po: null, so: null, director: null,
    manager: null, descripcion: 'Desc ' + folio, observaciones: null,
    activa: true, seguimiento: true, sin_categoria: false, prefijo: null, categorias: []
  };
  Object.keys(o || {}).forEach(function (k) { i[k] = o[k]; });
  return i;
}
function Cat(ruta, reduce, pct, dir, po, so) {
  return { categoria: ruta, tickets_reduce: reduce, pct_dism: pct, director: dir, po: po, so: so };
}

var DATOS = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'],
  agrupadores: ['Problem', 'SorIA', 'Adopcion', 'Mejora'],
  fecha_gen: '01/10/2026',
  // dbo.CatPrefijoProblem en el orden del servidor (PRB primero). ADO no
  // tiene iniciativas y aun asi es opcion.
  tipos_iniciativa: [{ prefijo: 'PRB', nombre: 'Problem' }, { prefijo: 'ADO', nombre: 'Adopción' },
    { prefijo: 'HAR', nombre: 'Hardware' }, { prefijo: 'MAP', nombre: 'Mejora aplicativo' },
    { prefijo: 'REQ', nombre: 'Requerimiento' }, { prefijo: '' }, { prefijo: 'PRB', nombre: 'Repetido' }],
  iniciativas: [
    // Dos categorias de distinto PO; retrasada.
    Ini('PRB 2026-000001', { prefijo: 'PRB', estado: 'En Solución', tickets_reduce: 150, vol_reduce_folio: 150, riesgo_folio: 150,
      retrazado: 1, sem_fecha: 'rojo', fecha_retrasada: true, f_solucion: '2026-09-01', n_solucion: 2,
      po: 'PO 1', so: 'SO x', director: 'Dir A', manager: 'Mgr 1',
      categorias: [Cat('/A/Cat 1/Hoja', 100, 0.5, 'Dir A', 'PO 1', 'SO x'),
                   Cat('/A/Cat 3', 50, 0.25, 'Dir A', 'PO 2', 'SO x')] }),
    Ini('MAP 2026-000002', { prefijo: 'MAP', agrup: 'Mejora', tickets_reduce: 40, vol_reduce_folio: 40,
      po: 'PO 1', so: 'SO y', director: 'Dir A',
      categorias: [Cat('/A/Cat 2', 40, 1, 'Dir A', 'PO 1', 'SO y')] }),
    // No activa
    Ini('HAR 2025-000003', { prefijo: 'HAR', tipo_iniciativa: 'Mejora Aplicativo', estado: 'Cerrado', activa: false, seguimiento: false, sem_fecha: 'verde',
      tickets_reduce: 30, vol_reduce_folio: 30, po: 'PO 3', so: 'SO z', director: 'Dir B',
      categorias: [Cat('/B/Cat 4', 30, 0.3, 'Dir B', 'PO 3', 'SO z')] }),
    // Activa, pero agrupacion fuera de las cuatro: no cuenta en Activas
    // (criterio de Experiencia) y retrasada no cuenta en Retrasadas.
    Ini('REQ 2026-000004', { prefijo: 'REQ', agrup: 'ReqOpr', seguimiento: false, retrazado: 1, sem_fecha: 'rojo', fecha_retrasada: true,
      f_analisis: '2026-01-01', tickets_reduce: 5, vol_reduce_folio: 5, riesgo_folio: 5,
      po: 'PO 3', so: 'SO z', director: 'Dir B',
      categorias: [Cat('/B/Cat 5', 5, 0.1, 'Dir B', 'PO 3', 'SO z')] }),
    // Sin categoria: dueños del Problem; retrasada pero no cuenta en
    // Retrasadas (Experiencia solo las cuenta por categoria).
    Ini('PRB 2026-000005', { sin_categoria: true, retrazado: 1, sem_fecha: 'rojo', fecha_retrasada: true,
      f_analisis: '2026-02-01', po: 'PO 1', so: 'SO w', director: 'Dir B', categorias: [] }),
    // Entrada invalida: se descarta
    { titulo: 'sin folio' }
  ]
};

// rol: 'ADM' por omision (las pruebas de siempre); null = aun sin rol; 'MOD'.
function Pagina(pedirRegistro, pedirCatalogo, rol) {
  if (rol === undefined) rol = 'ADM';
  var ventana = Elemento('window');
  var documento = Documento();
  function pedir(url) {
    if (/registro/.test(url)) return pedirRegistro(url);
    return (pedirCatalogo || nunca)(url);
  }
  (new Function('window', leer('assets/js/escape.js')))(ventana);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(ventana, ventana.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(ventana, documento);
  (new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'fetch', leer('admin/registro-iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, pedir);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'GloboAyuda', 'fetch', leer('admin/iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.GloboAyuda, pedir);
  return {
    ventana: ventana, doc: documento, sel: function (id) { return documento.getElementById(id); },
    registro: (function () {
      // Las pruebas de siempre describen las opciones COMPLETAS (ADM); las
      // de MOD / sin rol estan en la parte AL.
      if (rol) ventana.IniciativasPagina.fijarRol(rol);
      return ventana.IniciativasPagina.registro;
    })()
  };
}
function ok(json) { return function () { return Promise.resolve(Respuesta(200, json)); }; }

// Folios en el orden en que estan pintados
function folios(p) {
  var re = /<tr class="ini-fila[^"]*" data-folio="([^"]+)"/g, m, s = [];
  while ((m = re.exec(p.sel('regCuerpo').innerHTML))) s.push(m[1]);
  return s;
}
function kpis(p) {
  var re = /<div class="val">([^<]*)<\/div>/g, m, s = [];
  while ((m = re.exec(p.sel('regKpis').innerHTML))) s.push(m[1]);
  return s;
}
function elegir(p, id, v) { p.sel(id).value = v; p.sel(id).disparar('change'); }
// Casillas de un panel multi: "Todos/Todas" + una por opcion, :si/:no.
function casillasDe(p, panel) {
  var re = /<input type="checkbox" (data-[a-z]+-(?:todas|ini))="([^"]*)"( checked)?>/g, m, s = [];
  while ((m = re.exec(p.sel(panel).innerHTML))) s.push((/todas$/.test(m[1]) ? 'Todos' : m[2]) + (m[3] ? ':si' : ':no'));
  return s;
}
function marcarEn(p, panel, attr, valor) {
  var el = Elemento('casilla');
  el.setAttribute(attr, valor);
  p.sel(panel).disparar('change', { target: el });
}
// Deja marcado solo el estado `v` (o todos con '') por el panel, como lo
// haria alguien con el raton.
function soloEstado(p, v) {
  for (var n = 0; n < 3 && p.sel('regEstado').textContent !== (v ? 'Ninguno' : '— Todos —'); n++) {
    marcarEn(p, 'regEstadoPanel', 'data-estado-todas', '');
  }
  if (v) marcarEn(p, 'regEstadoPanel', 'data-estado-ini', v);
}
function clicFolio(p, folio) {
  var boton = Elemento('boton');
  boton.setAttribute('data-folio', folio);
  p.sel('regCuerpo').disparar('click', { target: boton });
  return boton;
}
function visibles(p) {
  return ['regCargando', 'regError', 'regSinDatos', 'regContenido'].filter(function (id) { return !p.sel(id).hidden; });
}

// Opciones completas (ADM) en las pruebas sin DOM de siempre.
function Adm(reg) { reg.fijarAlcance(true); return reg; }

var base = Pagina(nunca);
var R = base.ventana.RegistroIniciativas;
var pruebas = [];

// ---------------------------------------------------------------------------
// D) Sin DOM
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var reg = Adm(R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS))));
  Check('D1 entrada sin folio descartada', 5, reg.iniciativas.length);
  var k = R.Registro.indicadores(reg.iniciativas);
  Check('D2 indicadores: total/activas/retrasadas/no activas', [5, 3, 1, 1], [k.total, k.activas, k.retrasadas, k.noActivas]);
  Check('D2 riesgo = riesgo_folio de las retrasadas que cuentan', 150, k.riesgo);
  Check('D2 tickets a reducir de las activas', 190, k.reduceActivas);
  Check('D3 estados: activos en su orden y luego los demas', ['En Análisis', 'En Solución', 'Cerrado'], reg.estados());
  Check('D3 Agrupacion ya no es filtro: sin opciones en Registro', 'undefined', typeof reg.tipos);
  Check('D3 directores (incluye el del Problem sin categoria)', ['Dir A', 'Dir B'], reg.directores());
  Check('D4 sin lista lanza', true, (function () { try { R.Registro.desdeJson({}); return false; } catch (e) { return true; } })());

  var f = new R.FiltroRegistro(reg);
  function pasan() { return f.aplicar(reg.iniciativas).map(function (i) { return i.folio; }); }
  Check('D5 sin filtros pasan todas', 5, pasan().length);

  // PO 2 solo esta en la SEGUNDA categoria de PRB 1: pasa por esa fila.
  f.elegir(0, 'PO 2');
  Check('D6 PO por cualquier categoria', ['PRB 2026-000001'], pasan());
  f.elegir(0, 'PO 1');
  Check('D6 PO 1: con categoria y sin categoria (dueños del Problem)',
    ['PRB 2026-000001', 'MAP 2026-000002', 'PRB 2026-000005'], pasan());
  var e = f.cascada.estado(true, '');
  Check('D7 progresivo: SO de PO 1', ['SO w', 'SO x', 'SO y'], e[1].opciones);
  Check('D7 progresivo: Categorias de PO 1', ['/A/Cat 1/Hoja', '/A/Cat 2'], e[2].opciones);
  f.elegir(1, 'SO y');
  Check('D7 PO 1 + SO y', ['MAP 2026-000002'], pasan());
  Check('D7 categorias de PO 1 + SO y', ['/A/Cat 2'], f.cascada.estado(true, '')[2].opciones);
  // La misma fila debe cumplir todo: PO 2 + /A/Cat 1/Hoja no existe.
  f.limpiar();
  f.elegir(0, 'PO 2');
  Check('D8 combinacion inexistente no se ofrece', ['/A/Cat 3'], f.cascada.estado(true, '')[2].opciones);
  Check('D8 valor fuera de opciones no se acepta', false, f.elegir(2, '/A/Cat 1/Hoja'));

  f.limpiar();
  f.elegir(2, '/A/Cat 2');
  Check('D9 Categoria excluye las sin categoria', ['MAP 2026-000002'], pasan());

  f.limpiar();
  f.elegirDirector('Dir B');
  Check('D10 Director acota', ['HAR 2025-000003', 'REQ 2026-000004', 'PRB 2026-000005'], pasan());
  Check('D10 PO bajo Dir B', ['PO 1', 'PO 3'], f.cascada.estado(true, '')[0].opciones);
  f.elegir(0, 'PO 3');
  f.elegirDirector('Dir A');
  Check('D10 cambiar de Director suelta lo que ya no aplica', {}, f.cascada.filtros());
  f.elegir(0, 'PO 1');
  f.elegirDirector('Dir B');
  Check('D10 ... y conserva lo que si aplica', { po: 'PO 1' }, f.cascada.filtros());
  Check('D10 Dir B + PO 1', ['PRB 2026-000005'], pasan());

  f.limpiar();
  f.elegirEstado('Cerrado');
  Check('D11 Estado', ['HAR 2025-000003'], pasan());
  f.elegirEstado('Inventado');
  Check('D11 Estado fuera de catalogo = sin filtro', 5, pasan().length);
  Check('D12 Agrupacion ya no es filtro: sin elegirTipo', 'undefined', typeof f.elegirTipo);
  Check('D12 filtros activos', 0, f.activos());
  // El dato sigue: decide Activas (seguimiento) y se ve en la tabla.
  Check('D12 agrup sigue en los datos', 'ReqOpr', reg.buscar('REQ 2026-000004').agrup);

  var orden = R.ordenar(reg.iniciativas, null).map(function (i) { return i.folio; });
  Check('D13 orden por omision: riesgo, activas, reduce',
    ['PRB 2026-000001', 'REQ 2026-000004', 'MAP 2026-000002', 'PRB 2026-000005', 'HAR 2025-000003'], orden);
  Check('D13 orden por folio asc', 'HAR 2025-000003', R.ordenar(reg.iniciativas, { col: 'folio', dir: 'asc' })[0].folio);
});

// ---------------------------------------------------------------------------
// C) Carga y estados
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var p = Pagina(nunca);
  Check('C1 cargando: solo el aviso de carga', ['regCargando'], visibles(p));
  Check('C1 cargando: indicadores sin ceros', false, /<div class="val">0<\/div>/.test(p.sel('regKpis').innerHTML));
  Check('C1 cargando: aria-busy', 'true', p.sel('regKpis').getAttribute('aria-busy'));
  Check('C1 cargando: filtros bloqueados', true, p.sel('regPo').disabled);

  var q = Pagina(function () { return Promise.resolve(Respuesta(500, { error: 'El servidor de SQL rechazo la consulta (error 208).' })); });
  return esperar().then(function () {
    Check('C2 error 500: solo el error', ['regError'], visibles(q));
    Check('C2 error 500: mensaje del servidor', 'El servidor de SQL rechazo la consulta (error 208).', q.sel('regErrorTexto').textContent);
    Check('C2 error: sin indicadores', '', q.sel('regKpis').innerHTML);
    Check('C2 error: tabla sin filas', '', q.sel('regCuerpo').innerHTML);

    var r = Pagina(function () { return Promise.reject(new TypeError('fetch failed')); });
    var s = Pagina(ok({ algo: 1 }));
    var t = Pagina(ok({ iniciativas: [], estados_activos: [], agrupadores: [] }));
    return esperar().then(function () {
      Check('C3 red caida', ['regError', 'No se pudo conectar con el servidor.'], visibles(r).concat(r.sel('regErrorTexto').textContent));
      Check('C4 respuesta sin lista = error, no lista vacia', ['regError'], visibles(s));
      Check('C5 registro vacio: su propio aviso', ['regSinDatos'], visibles(t));
      // Reintento sobre el error
      return r.registro.cargar(ok(DATOS)).then(function () {
        Check('C6 reintentar carga', ['regContenido'], visibles(r));
      });
    });
  });
});

// ---------------------------------------------------------------------------
// L) Lista
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var p = Pagina(ok(DATOS));
  return esperar().then(function () {
    Check('L1 listo: contenido visible', ['regContenido'], visibles(p));
    Check('L1 cinco filas, en el orden por omision',
      ['PRB 2026-000001', 'REQ 2026-000004', 'MAP 2026-000002', 'PRB 2026-000005', 'HAR 2025-000003'], folios(p));
    Check('L2 indicadores', ['5', '3', '1', '1'], kpis(p));
    Check('L2 pie de retrasadas', true, /150 tickets en riesgo/.test(p.sel('regKpis').innerHTML));
    var html = p.sel('regCuerpo').innerHTML;
    Check('L3 retrasada: fecha en rojo, sin pintar la fila', [true, false],
      [/ini-vencida">01\/09\/2026<\/b> <span class="ini-retraso">Retrasada/.test(html), /<tr class="[^"]*(vencid|rojo)/.test(html)]);
    Check('L3 dueños distintos: el primero y +N', true, /PO 1 <span class="ini-mas">\+1<\/span>/.test(html));
    Check('L3 sin categoria marcada', true, /Sin categoría/.test(html));
    Check('L3 no activa sin fecha compromiso', true,
      /data-folio="HAR 2025-000003"[\s\S]*?ini-sem verde[^>]*><\/span><span class="ini-tenue">—/.test(html));
    Check('L4 cuenta', '5 iniciativas', p.sel('regCuenta').textContent);
    Check('L4 sin "Mostrar mas"', true, p.sel('regMas').hidden);
    Check('L5 filtros llenos', [['Todos:si', 'En Análisis:si', 'En Solución:si', 'Cerrado:si'], ['Dir A', 'Dir B'], ['PO 1', 'PO 2', 'PO 3']],
      [casillasDe(p, 'regEstadoPanel'), p.sel('regDirector').opciones(), p.sel('regPo').opciones()]);
    Check('L5 el select de Agrupacion no se llena', '', p.sel('regTipo').innerHTML);
    Check('L5 la columna Agrupacion sigue en la tabla', true, /data-col="Agrupación"><span class="chip ini-chip">Mejora/.test(html));

    elegir(p, 'regPo', 'PO 1');
    Check('L6 PO por select', ['PRB 2026-000001', 'MAP 2026-000002', 'PRB 2026-000005'], folios(p));
    Check('L6 SO acotado', ['SO w', 'SO x', 'SO y'], p.sel('regSo').opciones());
    Check('L6 indicadores siguen el filtro', ['3', '3', '1', '0'], kpis(p));
    Check('L6 cuenta con filtro', '3 de 5 iniciativas', p.sel('regCuenta').textContent);
    Check('L6 Limpiar habilitado', [false, '1 filtro activo'], [p.sel('regLimpiar').hidden, p.sel('regFiltrosCuenta').textContent]);
    elegir(p, 'regSo', 'SO y');
    elegir(p, 'regCategoria', '/A/Cat 2');
    Check('L7 PO -> SO -> Categoria', ['MAP 2026-000002'], folios(p));

    soloEstado(p, 'Cerrado');
    Check('L8 sin coincidencias: aviso, sin tabla', [false, true, ''], [p.sel('regVacio').hidden, p.sel('regTablaCaja').hidden, p.sel('regCuenta').textContent]);
    Check('L8 indicadores en 0 (dato real, no error)', ['0', '0', '0', '0'], kpis(p));
    p.sel('regLimpiarVacio').disparar('click');
    Check('L9 limpiar', [5, true, ''], [folios(p).length, p.sel('regVacio').hidden, p.sel('regPo').value]);

    p.sel('regCabeza').disparar('click', { target: (function () { var b = Elemento('th'); b.setAttribute('data-orden', 'folio'); return b; })() });
    Check('L10 ordenar por Codigo', 'HAR 2025-000003', folios(p)[0]);
    Check('L10 aria-sort', true, /aria-sort="ascending"><button type="button" class="ini-orden" data-orden="folio"/.test(p.sel('regCabeza').innerHTML));

    // "Mostrar mas" con mas de una pagina
    var muchas = JSON.parse(JSON.stringify(DATOS));
    for (var n = 0; n < 230; n++) muchas.iniciativas.push(Ini('X ' + (1000 + n), { categorias: [Cat('/A/Cat 2', 1, 0.1, 'Dir A', 'PO 1', 'SO y')] }));
    return p.registro.cargar(ok(muchas)).then(function () {
      Check('L11 primera pagina', [100, false], [folios(p).length, p.sel('regMas').hidden]);
      Check('L11 cuenta', '235 iniciativas · mostrando 100', p.sel('regCuenta').textContent);
      p.sel('regMas').disparar('click');
      p.sel('regMas').disparar('click');
      Check('L11 todas', [235, true], [folios(p).length, p.sel('regMas').hidden]);
    });
  });
});

// ---------------------------------------------------------------------------
// E) Detalle
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var p = Pagina(ok(DATOS));
  return esperar().then(function () {
    Check('E0 detalle cerrado al inicio', [true, true], [p.sel('regDetalle').hidden, p.sel('regDetFondo').hidden]);
    var origen = clicFolio(p, 'PRB 2026-000001');
    var html = p.sel('regDetCuerpo').innerHTML;
    Check('E1 abre', [false, false, 'PRB 2026-000001'], [p.sel('regDetalle').hidden, p.sel('regDetFondo').hidden, p.sel('regDetTitulo').textContent]);
    Check('E1 foco en cerrar', 1, p.sel('regDetCerrar').enfocado);
    Check('E2 secciones', ['Identificación', 'Organización', 'Impacto', 'Seguimiento', 'Categorías afectadas', 'Descripción'],
      (html.match(/<h4>[^<]+<\/h4>/g) || []).map(function (h) { return h.replace(/<\/?h4>/g, ''); }));
    var filasCat = html.match(/<td class="ini-cat-ruta">[^<]*<\/td>/g) || [];
    Check('E3 una fila por categoria, sin duplicar', ['/A/Cat 1/Hoja', '/A/Cat 3'],
      filasCat.map(function (t) { return t.replace(/<[^>]+>/g, ''); }));
    Check('E3 % y tickets por categoria', [true, true], [/50%<\/td><td class="num">100</.test(html), /25%<\/td><td class="num">50</.test(html)]);
    Check('E3 dueños por categoria cuando varian', true, /<th scope="col">Product Owner<\/th>/.test(html));
    Check('E4 impacto', [true, true], [/Tickets a reducir<\/dt><dd>150</.test(html), /Tickets en riesgo<\/dt><dd>150</.test(html)]);
    Check('E5 seguimiento: estado actual vencido y cambios', true,
      /ini-etapa-actual"><th scope="row">Solución <span class="ini-sub">estado actual<\/span><\/th><td class="fecha-cell"><b class="ini-vencida">01\/09\/2026<\/b><\/td><td class="num">2</.test(html));
    Check('E6 descripcion; observaciones vacias', [true, true], [/Desc PRB 2026-000001/.test(html), /Sin captura/.test(html)]);
    Check('E7 sin botones de editar ni guardar', false, /<button[^>]*>[^<]*(Editar|Guardar|Modificar)/.test(html));
    Check('E7 los unicos botones son Solicitar cambios e Historial', ['solicitar-cambios', 'historial'],
      (html.match(/data-accion="[^"]+"/g) || []).map(function (a) { return a.slice(13, -1); }));

    p.doc.disparar('keydown', { key: 'Escape' });
    Check('E9 Escape cierra y devuelve el foco', [true, true, 1], [p.sel('regDetalle').hidden, p.sel('regDetFondo').hidden, origen.enfocado]);

    clicFolio(p, 'PRB 2026-000005');
    var h2 = p.sel('regDetCuerpo').innerHTML;
    Check('E10 sin categoria', [true, true], [/no tiene categorías asignadas/.test(h2), /dueños son los capturados en el Problem/.test(h2)]);
    p.sel('regDetFondo').disparar('click');
    Check('E11 clic en el fondo cierra', true, p.sel('regDetalle').hidden);

    clicFolio(p, 'MAP 2026-000002');
    p.sel('tab-solicitudes').disparar('click');
    Check('E12 cambiar de vista cierra el detalle', true, p.sel('regDetalle').hidden);
    clicFolio(p, 'NO EXISTE');
    Check('E13 folio desconocido no abre', true, p.sel('regDetalle').hidden);
  });
});

// ---------------------------------------------------------------------------
// S2) Estado: varios a la vez (SeleccionVarios), como Tipo de iniciativa
// ---------------------------------------------------------------------------
// Estados: PRB 1 En Solución; MAP 2, REQ 4, PRB 5 En Análisis; HAR 3 Cerrado.
pruebas.push(function () {
  var S = new R.SeleccionVarios(function () { return ['a', 'b', 'c']; });
  Check('S2-1 SeleccionVarios: todos por omision', [null, ['a', 'b', 'c'], true, false, true],
    [S.marcados, S.lista(), S.todosMarcados(), S.activo(), S.pasa('z')]);
  S.alternar('b');
  Check('S2-1 desmarcar uno', [['a', 'c'], true, false], [S.marcados, S.pasa('a'), S.pasa('b')]);
  S.alternar('b');
  Check('S2-1 marcar el que faltaba vuelve a todos', null, S.marcados);
  S.todas();
  Check('S2-1 Todas con todo: ninguno', [[], false], [S.marcados, S.pasa('a')]);
  S.todas();
  Check('S2-1 Todas con nada: todos', null, S.marcados);
  S.solo('c');
  Check('S2-1 solo', ['c'], S.marcados);
  S.solo('zz');
  Check('S2-1 solo fuera de opciones = todos', null, S.marcados);

  var reg = Adm(R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS))));
  var f = new R.FiltroRegistro(reg);
  function pasan() { return f.aplicar(reg.iniciativas).map(function (i) { return i.folio; }); }
  var TODOS = ['En Análisis', 'En Solución', 'Cerrado'];
  Check('S2-2 por omision: todos los estados, sin filtro', [TODOS, 5, 0], [f.estadosMarcados(), pasan().length, f.activos()]);
  f.alternarEstado('En Análisis');
  Check('S2-3 sin En Análisis', ['PRB 2026-000001', 'HAR 2025-000003'], pasan());
  f.alternarEstado('En Solución');
  Check('S2-3 solo Cerrado', [['Cerrado'], ['HAR 2025-000003'], 1], [f.estadosMarcados(), pasan(), f.activos()]);
  f.alternarEstado('En Solución');
  Check('S2-4 varios estados = O', ['PRB 2026-000001', 'HAR 2025-000003'], pasan());
  f.todosEstados();
  Check('S2-5 Todos con algunos: todos', [5, 0], [pasan().length, f.activos()]);
  f.todosEstados();
  Check('S2-5 Todos con todo: ninguno, lista vacia', [[], [], 1], [f.estadosMarcados(), pasan(), f.activos()]);
  f.todosEstados();
  f.alternarEstado('Cerrado');
  f.alternarTipoIniciativa('PRB');
  Check('S2-6 Estado (sin Cerrado) Y Tipo (sin PRB)', [['MAP 2026-000002', 'REQ 2026-000004'], 2], [pasan(), f.activos()]);
  f.limpiar();
  Check('S2-7 Limpiar: todos', [TODOS, 5, 0], [f.estadosMarcados(), pasan().length, f.activos()]);
  f.elegirEstado('Cerrado');
  Check('S2-8 elegirEstado = solo ese', ['HAR 2025-000003'], pasan());
  f.elegirEstado('');
  Check('S2-8 elegirEstado vacio = todos', 5, pasan().length);

  var p = Pagina(ok(DATOS));
  function folios2() { return folios(p); }
  Check('S2-9 cargando: boton bloqueado', true, p.sel('regEstado').disabled);
  return esperar().then(function () {
    Check('S2-9 listo: Todos por omision', ['— Todos —', false, false],
      [p.sel('regEstado').textContent, p.sel('regEstado').disabled, p.sel('regEstado').classList.contains('con-valor')]);
    Check('S2-9 casillas: Todos y cada estado (activos primero)',
      ['Todos:si', 'En Análisis:si', 'En Solución:si', 'Cerrado:si'], casillasDe(p, 'regEstadoPanel'));
    Check('S2-10 panel cerrado al inicio', [true, 'false'], [p.sel('regEstadoPanel').hidden, p.sel('regEstado').getAttribute('aria-expanded')]);
    p.sel('regEstado').disparar('click');
    Check('S2-10 el boton abre el panel', [false, 'true'], [p.sel('regEstadoPanel').hidden, p.sel('regEstado').getAttribute('aria-expanded')]);
    p.sel('regTipoIni').disparar('click');
    Check('S2-10 abrir Tipo cierra Estado (uno a la vez)', [true, 'false', false],
      [p.sel('regEstadoPanel').hidden, p.sel('regEstado').getAttribute('aria-expanded'), p.sel('regTipoIniPanel').hidden]);
    p.sel('regEstado').disparar('click');
    Check('S2-10 ... y al reves', [false, true], [p.sel('regEstadoPanel').hidden, p.sel('regTipoIniPanel').hidden]);

    marcarEn(p, 'regEstadoPanel', 'data-estado-todas', '');
    Check('S2-11 Todos con todo marcado: ninguno, lista vacia',
      ['Ninguno', true, ['Todos:no', 'En Análisis:no', 'En Solución:no', 'Cerrado:no'], [], false, '1 filtro activo'],
      [p.sel('regEstado').textContent, p.sel('regEstado').classList.contains('con-valor'), casillasDe(p, 'regEstadoPanel'),
       folios2(), p.sel('regVacio').hidden, p.sel('regFiltrosCuenta').textContent]);
    marcarEn(p, 'regEstadoPanel', 'data-estado-ini', 'Cerrado');
    Check('S2-12 un estado', ['Cerrado', ['HAR 2025-000003']], [p.sel('regEstado').textContent, folios2()]);
    marcarEn(p, 'regEstadoPanel', 'data-estado-ini', 'En Solución');
    Check('S2-12 dos estados (O)', ['2 de 3 estados', 'En Solución, Cerrado', ['PRB 2026-000001', 'HAR 2025-000003']],
      [p.sel('regEstado').textContent, p.sel('regEstado').getAttribute('title'), folios2()]);
    Check('S2-12 el panel sigue abierto al elegir', false, p.sel('regEstadoPanel').hidden);
    marcarEn(p, 'regEstadoPanel', 'data-estado-ini', 'En Análisis');
    Check('S2-13 marcar el que faltaba: Todos otra vez', ['— Todos —', 5, ''],
      [p.sel('regEstado').textContent, folios2().length, p.sel('regFiltrosCuenta').textContent]);

    soloEstado(p, 'En Análisis');
    elegir(p, 'regPo', 'PO 1');
    Check('S2-14 Estado Y PO', ['MAP 2026-000002', 'PRB 2026-000005'], folios2());
    p.sel('regLimpiar').disparar('click');
    Check('S2-15 Limpiar filtros: Todos', ['— Todos —', 5, ['Todos:si', 'En Análisis:si', 'En Solución:si', 'Cerrado:si']],
      [p.sel('regEstado').textContent, folios2().length, casillasDe(p, 'regEstadoPanel')]);

    p.doc.disparar('keydown', { key: 'Escape' });
    Check('S2-16 Escape cierra el panel de Estado', [true, 'false', 1],
      [p.sel('regEstadoPanel').hidden, p.sel('regEstado').getAttribute('aria-expanded'), p.sel('regEstado').enfocado]);
    p.sel('regEstado').disparar('click');
    p.doc.disparar('click', { target: Elemento('fuera') });
    Check('S2-16 clic fuera lo cierra', true, p.sel('regEstadoPanel').hidden);

    var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
    Check('S2-17 marcado: el select viejo ya no esta; boton multi en su lugar', [false, true],
      [/id="regEstadoSel"/.test(html),
       /<div class="campo ini-multi" id="regEstadoCampo">\s*<label for="regEstado">Estado<\/label>\s*<button type="button" class="ini-multi-boton" id="regEstado"/.test(html)]);
  });
});

// ---------------------------------------------------------------------------
// S) Solicitar cambios e Historial de cambios (sin persistencia)
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var reg = Adm(R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS))));
  var S = R.SolicitudCambio;
  Check('S1 campos: solo las tres fechas compromiso', ['f_analisis', 'f_solucion', 'f_cierre'],
    S.campos().map(function (c) { return c.clave; }));
  var c = new S(reg.buscar('PRB 2026-000001'));
  Check('S2 por omision la fecha del estado actual', ['f_solucion', '2026-09-01'], [c.campo, c.actual()]);
  Check('S2 cerrada: sin campo por omision', '', new S(reg.buscar('HAR 2025-000003')).campo);
  Check('S3 vacia: falta fecha y motivo', ['propuesto', 'motivo'], c.validar().map(function (e) { return e.campo; }));
  c.propuesto = '2026-09-01'; c.motivo = '  ';
  Check('S3 misma fecha y motivo en blanco', ['La nueva fecha es igual a la actual.', 'Explica el motivo del cambio.'],
    c.validar().map(function (e) { return e.mensaje; }));
  c.propuesto = '2026-02-30'; c.motivo = 'Proveedor';
  Check('S3 fecha inexistente', ['propuesto'], c.validar().map(function (e) { return e.campo; }));
  c.campo = 'titulo';
  Check('S3 campo no designado se rechaza', ['campo'], c.validar().map(function (e) { return e.campo; }));
  c.campo = 'f_solucion'; c.propuesto = '2026-10-15';
  Check('S4 valida', [], c.validar());
  Check('S4 resumen', { folio: 'PRB 2026-000001', campo: 'f_solucion', rotulo: 'Fecha compromiso de Solución',
    anterior: '2026-09-01', nuevo: '2026-10-15', motivo: 'Proveedor' }, c.resumen());

  var peticiones = [];
  var p = Pagina(ok(DATOS), function (url) { peticiones.push(url); return nunca(); });
  function accion(a) {
    var el = Elemento('b'); el.setAttribute('data-accion', a);
    p.sel('regDetCuerpo').disparar('click', { target: el });
  }
  return esperar().then(function () {
    // Lo que la pagina pide al iniciar (catalogo de Nueva solicitud) no cuenta.
    peticiones.length = 0;
    clicFolio(p, 'PRB 2026-000001');
    var html = p.sel('regDetCuerpo').innerHTML;
    Check('S5 boton Solicitar cambios en el detalle', true,
      /<button type="button" class="btn linea chico" id="regCambioBoton" data-accion="solicitar-cambios" aria-expanded="false" aria-controls="regCambio">Solicitar cambios<\/button>/.test(html));
    Check('S5 formulario oculto al abrir', true, /<section class="ini-det-sec ini-cambio" id="regCambio" hidden><\/section>/.test(html));
    Check('S6 Historial plegado con su cuenta', [true, true, true],
      [/id="regHistBoton" data-accion="historial" aria-expanded="false"/.test(html),
       /<span>Historial de cambios \(0\)<\/span>/.test(html), /id="regHistCuerpo" hidden>/.test(html)]);
    Check('S6 Historial va al final del detalle', true, /Descripción[\s\S]*Historial de cambios/.test(html));

    accion('solicitar-cambios');
    var form = p.sel('regCambio').innerHTML;
    Check('S7 abre el formulario', [false, 'true', 1], [p.sel('regCambio').hidden, p.sel('regCambioBoton').getAttribute('aria-expanded'), p.sel('regCambioCampo').enfocado]);
    Check('S7 campo y valor actual por omision', [true, true],
      [/<option value="f_solucion" selected>Fecha compromiso de Solución/.test(form), /id="regCambioActual">01\/09\/2026</.test(form)]);
    Check('S7 sin campos que no sean fecha', 3, (form.match(/<option value="f_/g) || []).length);

    p.sel('regCambioCampo').value = 'f_analisis';
    p.sel('regDetCuerpo').disparar('change', { target: p.sel('regCambioCampo') });
    Check('S8 cambiar de campo muestra su valor', '01/12/2026', p.sel('regCambioActual').textContent);

    p.sel('regCambioNueva').value = '';
    p.sel('regCambioMotivo').value = '';
    accion('cambio-preparar');
    Check('S9 invalida: errores y aria-invalid', ['ini-cambio-msg error', 'true', 'true', 'false'],
      [p.sel('regCambioMsg').className, p.sel('regCambioNueva').getAttribute('aria-invalid'),
       p.sel('regCambioMotivo').getAttribute('aria-invalid'), p.sel('regCambioCampo').getAttribute('aria-invalid')]);

    p.sel('regCambioNueva').value = '2027-01-15';
    p.sel('regCambioMotivo').value = 'Dependencia con proveedor';
    accion('cambio-preparar');
    var msg = p.sel('regCambioMsg').innerHTML;
    Check('S10 valida: preparada, NO enviada', ['ini-cambio-msg listo', true, true],
      [p.sel('regCambioMsg').className, /Solicitud preparada, no enviada/.test(msg), /01\/12\/2026 → 15\/01\/2027/.test(msg)]);
    Check('S10 ninguna peticion al servidor', [], peticiones);
    Check('S10 el registro no cambia', '2026-12-01', p.registro.registro.buscar('PRB 2026-000001').f_analisis);

    accion('cambio-cancelar');
    Check('S11 Cancelar oculta y devuelve el foco', [true, 'false', ''],
      [p.sel('regCambio').hidden, p.sel('regCambioBoton').getAttribute('aria-expanded'), p.sel('regCambio').innerHTML]);
    accion('solicitar-cambios');
    accion('solicitar-cambios');
    Check('S11 el boton tambien alterna', true, p.sel('regCambio').hidden);

    accion('historial');
    Check('S12 Historial se despliega', ['true', false], [p.sel('regHistBoton').getAttribute('aria-expanded'), p.sel('regHistCuerpo').hidden]);
    accion('historial');
    Check('S12 ... y se pliega', ['false', true], [p.sel('regHistBoton').getAttribute('aria-expanded'), p.sel('regHistCuerpo').hidden]);
    accion('historial');
    clicFolio(p, 'MAP 2026-000002');
    accion('historial');
    Check('S13 otra iniciativa: el historial arranca plegado', 'true', p.sel('regHistBoton').getAttribute('aria-expanded'));

    // Con historial del servidor (App_Code/HistorialFechas.cs) pinta sus
    // filas menos la Linea base ('B'); N = solo los "Cambio n".
    var conHist = JSON.parse(JSON.stringify(DATOS));
    conHist.historial_estado = 'ok';
    conHist.historial_desde = '09/10/2026';
    conHist.iniciativas[0].historial = [
      { id: 1, campo: 'FechaSolucion', anterior: '2026-08-01', nuevo: '2026-09-01', operacion: 'U', origen: 'NO_DECLARADO',
        usuario: null, fecha: '15/07/2026 10:00', reconstruido: true },
      { id: 2, campo: 'FechaAnalisis', anterior: null, nuevo: '2026-07-01', operacion: 'B', origen: 'NO_DECLARADO',
        usuario: null, fecha: '09/10/2026 11:41', reconstruido: false },
      { id: 3, campo: 'FechaSolucion', anterior: '2026-09-01', nuevo: '2026-09-15', operacion: 'U', origen: 'ADMIN',
        usuario: 'SORIANA\\usuario<b>x</b>', fecha: '20/10/2026 09:30', reconstruido: false },
      { id: 4, campo: 'FechaCierre', anterior: '2026-11-01', nuevo: '2026-11-15', operacion: 'U', origen: 'ADMIN',
        usuario: 'SORIANA\\otro', fecha: '21/10/2026 09:00', reconstruido: false },
      { id: 5, campo: 'FechaCierre', anterior: '2026-11-15', nuevo: '2026-11-10', operacion: 'U', origen: 'ADMIN',
        usuario: 'SORIANA\\otro', fecha: '22/10/2026 09:00', reconstruido: false }];
    return p.registro.cargar(ok(conHist)).then(function () {
      clicFolio(p, 'PRB 2026-000001');
      var h = p.sel('regDetCuerpo').innerHTML;
      Check('S14 N cuenta solo los cambios (la base no suma)', true, /Historial de cambios \(3\)/.test(h));
      Check('S14 rotulos en orden, sin Linea base', ['Cambio 1', 'Cambio 2', 'Cambio 1', 'Adelanto (no cuenta)'],
        (h.match(/<td>(<b>)?(Cambio \d|Línea base|Adelanto \(no cuenta\))/g) || []).map(function (x) { return x.replace(/<\/?(td|b)>/g, ''); }));
      Check('S14 la base no se pinta: 4 filas', [false, 4],
        [/Línea base/.test(h), (h.match(/<tr><td>/g) || []).length]);
      Check('S14 Cierre: extension en negrita, adelanto sin negrita', [true, true],
        [/<td><b>Cambio 1<\/b><\/td><td>01\/11\/2026<\/td><td>15\/11\/2026<\/td>/.test(h),
         /<td>Adelanto \(no cuenta\)<\/td><td>15\/11\/2026<\/td><td>10\/11\/2026<\/td>/.test(h)]);
      Check('S14 reconstruida con fecha aproximada; Admin con usuario escapado', [true, true, false, true],
        [/<td>≈ 15\/07\/2026<\/td>/.test(h), /SORIANA\\usuario&lt;b&gt;x&lt;\/b&gt;/.test(h), /usuario<b>x<\/b>/.test(h),
         /<td>No declarado<\/td>/.test(h)]);
      Check('S14 nota: desde, aproximadas y regla de Cierre', [true, true, true],
        [/Registro automático desde el 09\/10\/2026/.test(h), /Reconstruido de los comentarios del Excel/.test(h),
         /en Cierre solo cuentan las extensiones/.test(h)]);
      Check('S14 sigue plegado', true, /id="regHistCuerpo" hidden>/.test(h));

      // Sin filas: el texto depende de historial_estado.
      var estados = ['sin_tabla', 'error', 'ok'].map(function (e) {
        var d = JSON.parse(JSON.stringify(DATOS));
        d.historial_estado = e;
        d.historial_desde = e === 'ok' ? '09/10/2026' : null;
        return d;
      });
      var textos = [];
      return estados.reduce(function (c, d) {
        return c.then(function () {
          return p.registro.cargar(ok(d)).then(function () {
            clicFolio(p, 'PRB 2026-000001');
            textos.push(p.sel('regDetCuerpo').innerHTML);
          });
        });
      }, Promise.resolve()).then(function () {
        Check('S15 sin filas: no instalado / no se pudo leer / sin movimientos', [true, true, true, true],
          [/todavía no está instalado/.test(textos[0]), /No se pudo leer el historial/.test(textos[1]),
           /Sin movimientos de fecha registrados desde el 09\/10\/2026/.test(textos[2]),
           textos.every(function (t) { return /Historial de cambios \(0\)/.test(t); })]);

        // Solo Linea base: estado vacio, no la tabla. 'I' (Fecha inicial)
        // si se pinta.
        var soloBase = JSON.parse(JSON.stringify(DATOS));
        soloBase.historial_estado = 'ok';
        soloBase.historial_desde = '09/10/2026';
        soloBase.iniciativas[0].historial = ['FechaAnalisis', 'FechaCierre'].map(function (c, k) {
          return { id: k + 1, campo: c, anterior: null, nuevo: '2026-12-01', operacion: 'B', origen: 'NO_DECLARADO',
                   usuario: null, fecha: '09/10/2026 11:41', reconstruido: false };
        });
        soloBase.iniciativas[1].historial = [
          { id: 3, campo: 'FechaAnalisis', anterior: null, nuevo: '2026-11-20', operacion: 'I', origen: 'NO_DECLARADO',
            usuario: null, fecha: '12/10/2026 08:00', reconstruido: false }];
        return p.registro.cargar(ok(soloBase)).then(function () {
          clicFolio(p, 'PRB 2026-000001');
          var b = p.sel('regDetCuerpo').innerHTML;
          Check('S16 solo Linea base: vacio, sin tabla, N = 0', [true, false, false, true],
            [/Sin movimientos de fecha registrados desde el 09\/10\/2026/.test(b), /Línea base/.test(b),
             /<th scope="col">Movimiento<\/th>/.test(b), /Historial de cambios \(0\)/.test(b)]);
          clicFolio(p, 'MAP 2026-000002');
          var ini = p.sel('regDetCuerpo').innerHTML;
          Check('S16 Fecha inicial sigue visible y no cuenta', [true, true, true],
            [/<td>Fecha inicial<\/td><td>—<\/td><td>20\/11\/2026<\/td>/.test(ini), /<th scope="col">Movimiento<\/th>/.test(ini),
             /Historial de cambios \(0\)/.test(ini)]);
        });
      });
    });
  });
});

// ---------------------------------------------------------------------------
// T) Tipo de iniciativa
// ---------------------------------------------------------------------------
// Prefijos: PRB 1 -> PRB; MAP 2 -> MAP; HAR 3 -> HAR (aunque su
// TipoIniciativa del Excel diga "Mejora Aplicativo"); REQ 4 -> REQ; PRB 5 sin
// prefijo (no pasa hoy: 933/933 tienen; solo pasaria con Todas). ADO: sin
// iniciativas.
pruebas.push(function () {
  var reg = Adm(R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS))));
  var f = new R.FiltroRegistro(reg);
  function pasan() { return f.aplicar(reg.iniciativas).map(function (i) { return i.folio; }); }
  function solo(pref) {
    f.limpiar();
    TODOS.forEach(function (t) { if (pref.indexOf(t) < 0) f.alternarTipoIniciativa(t); });
  }
  var TODOS = ['PRB', 'ADO', 'HAR', 'MAP', 'REQ'];

  Check('T1 opciones = catalogo completo, en su orden, sin vacios ni repetidos', TODOS, reg.tiposIniciativa());
  Check('T1 texto = Descripcion', ['Problem', 'Adopción', 'Hardware', 'Mejora aplicativo', 'Requerimiento', 'XYZ'],
    TODOS.concat('XYZ').map(function (t) { return reg.nombreTipo(t); }));
  Check('T1 no son las agrupaciones', -1, TODOS.indexOf('ReqOpr'));
  Check('T2 por omision: todos marcados (null), sin filtro', [null, TODOS, 5, 0, true],
    [f.tiposIni, f.tiposIniciativa(), pasan().length, f.activos(), f.todosMarcados()]);

  solo(['HAR']);
  Check('T2b filtra por Problem.Prefijo, no por TipoIniciativa', ['HAR 2025-000003'], pasan());
  solo(['MAP']);
  Check('T2b MAP no trae a HAR aunque su TipoIniciativa sea Mejora Aplicativo', ['MAP 2026-000002'], pasan());
  solo(['ADO']);
  Check('T2b tipo sin iniciativas: lista vacia', [], pasan());
  f.limpiar();

  ['ADO', 'HAR', 'MAP', 'REQ'].forEach(function (t) { f.alternarTipoIniciativa(t); });
  Check('T3 solo PRB (el sin prefijo queda fuera)', [['PRB'], ['PRB 2026-000001'], 1],
    [f.tiposIni, pasan(), f.activos()]);
  f.alternarTipoIniciativa('HAR');
  Check('T4 varios = O', ['PRB 2026-000001', 'HAR 2025-000003'], pasan());
  f.alternarTipoIniciativa('Inventado');
  Check('T4 tipo fuera del catalogo se ignora', ['PRB', 'HAR'], f.tiposIni);

  f.alternarTipoIniciativa('PRB');
  f.alternarTipoIniciativa('HAR');
  Check('T5 desmarcar todos = ninguno: no pasa nada, cuenta como filtro', [[], [], 0, 1, false],
    [f.tiposIni, f.tiposIniciativa(), pasan().length, f.activos(), f.todosMarcados()]);

  TODOS.forEach(function (t) { f.alternarTipoIniciativa(t); });
  Check('T6 volver a marcarlos todos = todos (null)', [null, 5], [f.tiposIni, pasan().length]);

  f.todosTiposIniciativa();
  Check('T7 Todas con todo marcado: desmarca todo', [[], 0], [f.tiposIni, pasan().length]);
  f.todosTiposIniciativa();
  Check('T7 Todas con nada marcado: marca todo', [null, TODOS, 5], [f.tiposIni, f.tiposIniciativa(), pasan().length]);
  f.alternarTipoIniciativa('PRB');
  f.todosTiposIniciativa();
  Check('T7 Todas con algunos marcados: marca todo', [null, 5], [f.tiposIni, pasan().length]);

  // Junto con los demas filtros (Y entre filtros).
  solo(['PRB', 'HAR']);
  f.elegirEstado('Cerrado');
  Check('T8 + Estado', ['HAR 2025-000003'], pasan());
  f.elegirEstado('');
  f.elegirDirector('Dir A');
  Check('T8 + Director', ['PRB 2026-000001'], pasan());
  f.elegir(0, 'PO 2');
  Check('T8 + PO', ['PRB 2026-000001'], pasan());
  f.elegirDirector('');
  f.cascada.limpiar(0);
  f.elegir(1, 'SO z');
  Check('T8 + SO', ['HAR 2025-000003'], pasan());
  f.elegir(2, '/B/Cat 4');
  Check('T8 + Categoria', ['HAR 2025-000003'], pasan());
  Check('T8 filtros activos cuentan el tipo', 3, f.activos());

  f.limpiar();
  Check('T9 limpiar: Todas', [null, 5, 0], [f.tiposIni, pasan().length, f.activos()]);

  var sinCat = Adm(R.Registro.desdeJson({ iniciativas: [] }));
  Check('T9 sin catalogo: sin opciones', [], sinCat.tiposIniciativa());
});

pruebas.push(function () {
  var p = Pagina(ok(DATOS));
  function casillas() {
    var re = /<input type="checkbox" (data-tipo-[a-z]+)="([^"]*)"( checked)?>/g, m, s = [];
    while ((m = re.exec(p.sel('regTipoIniPanel').innerHTML))) s.push((m[1] === 'data-tipo-todas' ? 'Todas' : m[2]) + (m[3] ? ':si' : ':no'));
    return s;
  }
  function marcar(attr, valor) {
    var el = Elemento('casilla');
    el.setAttribute(attr, valor);
    p.sel('regTipoIniPanel').disparar('change', { target: el });
  }
  Check('T10 cargando: boton bloqueado', true, p.sel('regTipoIni').disabled);
  return esperar().then(function () {
    Check('T10 listo: Todas por omision', ['— Todas —', false, false],
      [p.sel('regTipoIni').textContent, p.sel('regTipoIni').disabled, p.sel('regTipoIni').classList.contains('con-valor')]);
    Check('T10 casillas: Todas y cada prefijo del catalogo, todas marcadas',
      ['Todas:si', 'PRB:si', 'ADO:si', 'HAR:si', 'MAP:si', 'REQ:si'], casillas());
    Check('T10 se ve la Descripcion', [true, true],
      [/data-tipo-ini="HAR" checked><span>Hardware<\/span>/.test(p.sel('regTipoIniPanel').innerHTML),
       /data-tipo-ini="ADO" checked><span>Adopción<\/span>/.test(p.sel('regTipoIniPanel').innerHTML)]);
    Check('T11 panel cerrado al inicio', [true, 'false'], [p.sel('regTipoIniPanel').hidden, p.sel('regTipoIni').getAttribute('aria-expanded')]);
    p.sel('regTipoIni').disparar('click');
    Check('T11 el boton abre el panel', [false, 'true'], [p.sel('regTipoIniPanel').hidden, p.sel('regTipoIni').getAttribute('aria-expanded')]);

    ['ADO', 'HAR', 'MAP', 'REQ'].forEach(function (t) { marcar('data-tipo-ini', t); });
    Check('T12 un tipo filtra la lista', ['PRB 2026-000001'], folios(p));
    Check('T12 boton (Descripcion) y casillas lo muestran', ['Problem', true, ['Todas:no', 'PRB:si', 'ADO:no', 'HAR:no', 'MAP:no', 'REQ:no']],
      [p.sel('regTipoIni').textContent, p.sel('regTipoIni').classList.contains('con-valor'), casillas()]);
    Check('T12 cuenta y Limpiar', ['1 filtro activo', false], [p.sel('regFiltrosCuenta').textContent, p.sel('regLimpiar').hidden]);
    Check('T12 el panel sigue abierto al elegir', false, p.sel('regTipoIniPanel').hidden);
    marcar('data-tipo-ini', 'HAR');
    Check('T13 dos tipos (O)', [['PRB 2026-000001', 'HAR 2025-000003'], '2 de 5 tipos', 'Problem, Hardware'],
      [folios(p), p.sel('regTipoIni').textContent, p.sel('regTipoIni').getAttribute('title')]);

    elegir(p, 'regPo', 'PO 3');
    Check('T14 junto con PO', ['HAR 2025-000003'], folios(p));
    soloEstado(p, 'Cerrado');
    Check('T14 ... y Estado', ['HAR 2025-000003'], folios(p));

    p.sel('regLimpiar').disparar('click');
    Check('T15 Limpiar filtros: Todas otra vez', ['— Todas —', 5, ['Todas:si', 'PRB:si', 'ADO:si', 'HAR:si', 'MAP:si', 'REQ:si']],
      [p.sel('regTipoIni').textContent, folios(p).length, casillas()]);

    marcar('data-tipo-ini', 'PRB');
    Check('T16 desmarcar uno desde Todas: los demas; sin prefijo fuera', ['REQ 2026-000004', 'MAP 2026-000002', 'HAR 2025-000003'], folios(p));
    marcar('data-tipo-todas', '');
    Check('T16 la casilla Todas restablece', ['— Todas —', 5, ''], [p.sel('regTipoIni').textContent, folios(p).length, p.sel('regFiltrosCuenta').textContent]);

    marcar('data-tipo-todas', '');
    Check('T18 Todas con todo marcado: nada marcado y nada en la lista',
      ['Ninguno', true, ['Todas:no', 'PRB:no', 'ADO:no', 'HAR:no', 'MAP:no', 'REQ:no'], [], false, '1 filtro activo'],
      [p.sel('regTipoIni').textContent, p.sel('regTipoIni').classList.contains('con-valor'), casillas(), folios(p),
       p.sel('regVacio').hidden, p.sel('regFiltrosCuenta').textContent]);
    marcar('data-tipo-ini', 'HAR');
    Check('T18 desde ninguno, marcar uno', ['Hardware', ['HAR 2025-000003']], [p.sel('regTipoIni').textContent, folios(p)]);
    marcar('data-tipo-todas', '');
    Check('T18 Todas con algunos: todo marcado otra vez', ['— Todas —', 5, ['Todas:si', 'PRB:si', 'ADO:si', 'HAR:si', 'MAP:si', 'REQ:si']],
      [p.sel('regTipoIni').textContent, folios(p).length, casillas()]);

    // Paginacion intacta con el filtro de tipos.
    var muchas = JSON.parse(JSON.stringify(DATOS));
    for (var n = 0; n < 150; n++) muchas.iniciativas.push(Ini('PRB 2026-00' + (1000 + n), { prefijo: 'PRB' }));
    return p.registro.cargar(ok(muchas)).then(function () {
      ['ADO', 'HAR', 'MAP', 'REQ'].forEach(function (t) { marcar('data-tipo-ini', t); });
      Check('T19 paginacion con tipos: 100 de 151', [100, false, '151 de 155 iniciativas · mostrando 100'],
        [folios(p).length, p.sel('regMas').hidden, p.sel('regCuenta').textContent]);
      p.sel('regMas').disparar('click');
      Check('T19 Mostrar mas sigue el filtro', [151, true], [folios(p).length, p.sel('regMas').hidden]);
      marcar('data-tipo-todas', '');
      marcar('data-tipo-todas', '');
      Check('T19 ninguno: lista vacia, sin Mostrar mas', [0, true], [folios(p).length, p.sel('regMas').hidden]);
    });
  }).then(function () {

    p.sel('regTipoIni').disparar('click');
    Check('T17 el panel abre de nuevo tras recargar', false, p.sel('regTipoIniPanel').hidden);
    p.doc.disparar('keydown', { key: 'Escape' });
    Check('T17 Escape cierra el panel', [true, 'false'], [p.sel('regTipoIniPanel').hidden, p.sel('regTipoIni').getAttribute('aria-expanded')]);
  });
});

// ---------------------------------------------------------------------------
// V) La pagina sigue igual con el registro cargado
// ---------------------------------------------------------------------------
var CATALOGO = {
  tipos: [{ prefijo: 'MAP', nombre: 'Mejora aplicativo' }], omitidas: 0,
  asignaciones: [{ director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' }],
  // ?rutas=1 (Nueva solicitud): la misma forma, con la ruta real.
  rutas: [{ director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1/Hoja' }]
};
pruebas.push(function () {
  var p = Pagina(ok(DATOS), ok(CATALOGO));
  return esperar().then(function () {
    Check('V1 inicio: Iniciativas con el registro', [false, true, true],
      [p.sel('panel-iniciativas').hidden, p.sel('panel-solicitudes').hidden, p.sel('panel-nueva').hidden]);
    p.sel('btnSolicitar').disparar('click');
    Check('V2 el boton abre Nueva solicitud', [true, false], [p.sel('panel-iniciativas').hidden, p.sel('panel-nueva').hidden]);
    elegir(p, 'selTipo', 'MAP');
    elegir(p, 'selPo', 'PO 1');
    p.sel('btnVolver').disparar('click');
    elegir(p, 'regPo', 'PO 2');           // filtrar la lista no toca el borrador
    clicFolio(p, 'PRB 2026-000001');
    p.sel('selTipo').value = ''; p.sel('selPo').value = '';
    p.sel('btnSolicitar').disparar('click');
    Check('V3 borrador intacto tras usar el registro', ['MAP', 'PO 1'], [p.sel('selTipo').value, p.sel('selPo').value]);
    Check('V3 abrir Nueva cierra el detalle', true, p.sel('regDetalle').hidden);
    p.sel('btnVolver').disparar('click');
    Check('V4 el filtro del registro tambien se conserva', ['PRB 2026-000001'], folios(p));
  });
});

// ---------------------------------------------------------------------------
// H) Marcado
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var html = leer('admin/iniciativas.html').replace(/<!--[\s\S]*?-->/g, '');
  Check('H1 sin "en preparacion" en Iniciativas', false, /Registro de iniciativas en preparación/.test(html));
  Check('H2 Solicitar para ADM y MOD: oculto hasta que SesionAdmin diga autorizado', true,
    /<button type="button" class="btn ini-cta" id="btnSolicitar" data-solo-admin hidden>/.test(html));
  Check('H2 [hidden] gana al display del CTA', true,
    /\.btn\.ini-cta\[hidden\] \{ display: none; \}/.test(leer('admin/iniciativas.css')));
  Check('H3 orden de scripts', true,
    /cascada-organizacional\.js[\s\S]*registro-iniciativas\.js[\s\S]*iniciativas\.js"/.test(html));
  Check('H4 sin botones de editar/descargar', false, /(Editar|Modificar|Descargar)/.test(html));
  Check('H5 sin filtro de Agrupacion', [false, false], [/id="regTipo"/.test(html), /<label[^>]*>Agrupación<\/label>/.test(html)]);
  Check('H5 Tipo de iniciativa sigue como multiselect', true,
    /<label for="regTipoIni">Tipo de iniciativa<\/label>\s*<button type="button" class="ini-multi-boton" id="regTipoIni"/.test(html));
  Check('H7 el detalle sigue rotulado Solo lectura', true, /<span class="ini-hint">Solo lectura<\/span>/.test(html));

  // Sin desbordar a lo ancho: el panel cuelga del ancho de su campo, el
  // boton mide lo que su columna y los textos largos se parten.
  var css = leer('admin/iniciativas.css').replace(/\/\*[\s\S]*?\*\//g, '');
  function regla(sel) {
    var i = css.indexOf(sel + ' {');
    return i < 0 ? '' : css.slice(i, css.indexOf('}', i)).replace(/\s+/g, ' ');
  }
  var panel = regla('.ini-multi-panel'), boton = regla('.ini-multi-boton'), op = regla('.filtros.ini-filtros .ini-multi-op');
  Check('H6 panel: del ancho de su campo, sin ancho fijo', [true, true, false],
    [/left: 0; right: 0/.test(panel), /overflow-y: auto/.test(panel), /(^|[ ;{])(min-)?width:/.test(panel)]);
  Check('H6 boton: 100% de la columna, texto recortado', [true, true],
    [/width: 100%/.test(boton), /text-overflow: ellipsis/.test(boton)]);
  Check('H6 opciones largas se parten', true, /overflow-wrap: anywhere/.test(op));
  Check('H6 la rejilla de 560px sigue igual', true,
    /\.filtros\.ini-filtros \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/.test(css));
});

// ---------------------------------------------------------------------------
// HF) Rotulos del historial de fechas (etiquetarHistorial)
// ---------------------------------------------------------------------------
pruebas.push(function () {
  function rot(lista) { return R.etiquetarHistorial(lista).map(function (f) { return f.etiqueta + (f.cuenta ? '*' : ''); }); }
  function u(campo, a, n) { return { campo: campo, anterior: a, nuevo: n, operacion: 'U' }; }
  Check('HF1 base, inicial, asignada, retirada no cuentan',
    ['Línea base', 'Fecha inicial', 'Fecha asignada', 'Fecha retirada'],
    rot([{ campo: 'FechaAnalisis', anterior: null, nuevo: '2026-01-01', operacion: 'B' },
         { campo: 'FechaAnalisis', anterior: null, nuevo: '2026-01-01', operacion: 'I' },
         u('FechaSolucion', null, '2026-02-01'), u('FechaSolucion', '2026-02-01', null)]));
  Check('HF2 Analisis y Solucion cuentan adelantos y extensiones; n por campo',
    ['Cambio 1*', 'Cambio 1*', 'Cambio 2*', 'Cambio 2*'],
    rot([u('FechaAnalisis', '2026-03-01', '2026-02-01'), u('FechaSolucion', '2026-03-01', '2026-04-01'),
         u('FechaAnalisis', '2026-02-01', '2026-05-01'), u('FechaSolucion', '2026-04-01', '2026-03-15')]));
  Check('HF3 Cierre: solo las extensiones cuentan',
    ['Cambio 1*', 'Adelanto (no cuenta)', 'Cambio 2*'],
    rot([u('FechaCierre', '2026-03-01', '2026-04-01'), u('FechaCierre', '2026-04-01', '2026-03-20'),
         u('FechaCierre', '2026-03-20', '2026-05-01')]));
  Check('HF4 fila sin operacion o vacia: — y no cuenta', ['—', '—'], rot([{ campo: 'FechaCierre' }, null]));
  Check('HF5 sin lista: vacio', 0, R.etiquetarHistorial(undefined).length);
});

// ---------------------------------------------------------------------------
// B) Busqueda por folio o titulo: un paso mas de FiltroRegistro.aplicar,
//    sobre lo que dejan los demas filtros. Parcial ('12' trae todo folio
//    con 12), sin importar mayusculas, separadores ni ceros a la izquierda;
//    titulo sin mayusculas ni acentos. No toca la Cobertura.
// ---------------------------------------------------------------------------
var DATOS_BUSQUEDA = (function () {
  var d = JSON.parse(JSON.stringify(DATOS));
  d.iniciativas.push(
    Ini('PRB 2026-000012', { prefijo: 'PRB', titulo: 'Reducción de incidentes de red', po: 'PO 1', so: 'SO x', director: 'Dir A',
      categorias: [Cat('/A/Cat 1/Hoja', 10, 0.1, 'Dir A', 'PO 1', 'SO x')] }),
    Ini('MAP 2026-000120', { prefijo: 'MAP', titulo: 'MIGRACIÓN de correo', po: 'PO 3', so: 'SO z', director: 'Dir B',
      categorias: [Cat('/B/Cat 4', 20, 0.2, 'Dir B', 'PO 3', 'SO z')] }),
    Ini('REQ 2026-001234', { prefijo: 'REQ', titulo: 'Alta de usuarios', po: 'PO 3', so: 'SO z', director: 'Dir B',
      categorias: [Cat('/B/Cat 5', 1, 0.1, 'Dir B', 'PO 3', 'SO z')] }),
    Ini('PRB 2025-000012', { prefijo: 'PRB', titulo: 'Caída del portal', estado: 'Cerrado', activa: false, seguimiento: false,
      po: 'PO 1', so: 'SO x', director: 'Dir A',
      categorias: [Cat('/A/Cat 3', 2, 0.1, 'Dir A', 'PO 2', 'SO x')] }));
  return d;
})();
var CON_12 = ['MAP 2026-000120', 'PRB 2025-000012', 'PRB 2026-000012', 'REQ 2026-001234'];
function esperarBusqueda() { return new Promise(function (ok) { setTimeout(ok, R.BUSQUEDA_ESPERA + 50); }); }
function teclear(p, v) { p.sel('regBuscar').value = v; p.sel('regBuscar').disparar('input'); }

pruebas.push(function () {
  var reg = Adm(R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS_BUSQUEDA))));
  var f = new R.FiltroRegistro(reg);
  function pasan() { return f.aplicar(reg.iniciativas).map(function (i) { return i.folio; }).sort(); }
  function con(v) { f.buscar(v); return pasan(); }

  Check('B1 sin busqueda: las 9, sin filtro activo', [9, 0, false], [pasan().length, f.activos(), f.busquedaActiva()]);
  Check('B1 solo espacios = sin busqueda', [9, 0], [con('   ').length, f.activos()]);
  Check('B2 "12": todo folio con 12 en su numero', CON_12, con('12'));
  Check('B2 "12" cuenta como un filtro', 1, f.activos());
  Check('B2 "1": parcial de un digito', ['MAP 2026-000120', 'PRB 2025-000012', 'PRB 2026-000001', 'PRB 2026-000012', 'REQ 2026-001234'], con('1'));
  Check('B2 "0012": parcial con ceros', CON_12, con('0012'));
  Check('B3 folio completo', ['PRB 2026-000012'], con('PRB 2026-000012'));
  Check('B3 minusculas y guion', ['PRB 2026-000012'], con('prb-2026-000012'));
  Check('B3 sin separadores', ['PRB 2026-000012'], con('PRB2026000012'));
  Check('B3 otro ancho de secuencia (7 digitos)', ['PRB 2026-000012'], con('PRB-2026-0000012'));
  Check('B3 ano y secuencia: parcial (secuencias de 2026 que empiezan en 12)', ['MAP 2026-000120', 'PRB 2026-000012', 'REQ 2026-001234'], con('2026-0000012'));
  Check('B3 sufijo con ceros "0000012" = "12"', CON_12, con('0000012'));
  Check('B3 folio parcial "prb 2025"', ['PRB 2025-000012'], con('prb 2025'));
  Check('B3 prefijo "map"', ['MAP 2026-000002', 'MAP 2026-000120'], con('map'));
  Check('B4 nombre sin acento ni mayusculas', ['PRB 2026-000012'], con('reduccion'));
  Check('B4 nombre con acento contra titulo en mayusculas', ['MAP 2026-000120'], con('migración'));
  Check('B4 nombre parcial a mitad de titulo', ['PRB 2026-000012'], con('INCIDENTES   de'));
  Check('B4 sin coincidencias', [], con('zzz'));

  f.buscar('12');
  f.estados.solo('Cerrado');
  Check('B5 Estado Cerrado Y "12"', [['PRB 2025-000012'], 2], [pasan(), f.activos()]);
  f.todosEstados();
  f.alternarTipoIniciativa('PRB');
  Check('B5 Tipo sin PRB Y "12"', ['MAP 2026-000120', 'REQ 2026-001234'], pasan());
  f.limpiar();
  f.buscar('12');
  f.elegirDirector('Dir A');
  Check('B5 Director Y "12"', ['PRB 2025-000012', 'PRB 2026-000012'], pasan());
  f.elegirDirector('');
  f.elegir(0, 'PO 3');
  Check('B5 PO Y "12"', ['MAP 2026-000120', 'REQ 2026-001234'], pasan());
  f.elegir(1, 'SO z');
  f.elegir(2, '/B/Cat 5');
  Check('B5 PO -> SO -> Categoria Y "12"', [['REQ 2026-001234'], 4], [pasan(), f.activos()]);
  Check('B5 la busqueda no cambia las opciones de la cascada', ['PO 1', 'PO 2', 'PO 3'],
    f.cascada.estado(true, '')[0].opciones);

  // La Cobertura usa pasa / pasaAtributos: la busqueda no la toca.
  f.limpiar();
  f.buscar('zzz');
  Check('B6 pasa() y pasaAtributos() ignoran la busqueda', [true, true, []],
    [reg.iniciativas.every(function (i) { return f.pasa(i); }), reg.iniciativas.every(function (i) { return f.pasaAtributos(i); }), pasan()]);

  f.limpiar();
  Check('B7 Limpiar borra la busqueda', [9, 0, '', false], [pasan().length, f.activos(), f.textoBuscado, f.busquedaActiva()]);
});

pruebas.push(function () {
  var p = Pagina(ok(DATOS_BUSQUEDA));
  var todos;
  return esperar().then(function () {
    todos = folios(p);
    Check('BV1 caja habilitada y visible al cargar', [false, false, 9], [p.sel('regBuscar').disabled, p.sel('regBuscarCampo').hidden, todos.length]);

    teclear(p, '12');
    Check('BV2 no repinta en cada tecla', 9, folios(p).length);
    return esperarBusqueda();
  }).then(function () {
    Check('BV2 "12" tras la espera, en el orden de la lista', todos.filter(function (f) { return CON_12.indexOf(f) >= 0; }), folios(p));
    Check('BV2 cuenta y filtros activos', ['4 de 9 iniciativas', '1 filtro activo', false],
      [p.sel('regCuenta').textContent, p.sel('regFiltrosCuenta').textContent, p.sel('regLimpiar').hidden]);

    elegir(p, 'regPo', 'PO 1');
    // PRB 2025-000012 tiene 12 pero su categoria es de PO 2: fuera.
    Check('BV3 PO 1 Y "12": la busqueda sigue', ['PRB 2026-000012'], folios(p));
    Check('BV3 dos filtros activos', '2 filtros activos', p.sel('regFiltrosCuenta').textContent);

    teclear(p, 'zzz');
    return esperarBusqueda();
  }).then(function () {
    Check('BV4 sin coincidencias con otro filtro: aviso', [false, true, 'No hay iniciativas que coincidan con «zzz» y los filtros seleccionados.'],
      [p.sel('regVacio').hidden, p.sel('regTablaCaja').hidden, p.sel('regVacioTexto').textContent]);
    elegir(p, 'regPo', '');
    Check('BV4 sin coincidencias solo con la busqueda', 'No hay iniciativas que coincidan con «zzz».', p.sel('regVacioTexto').textContent);

    // Enter: aplica sin esperar y con un solo resultado abre el detalle.
    p.sel('regBuscar').value = 'PRB-2026-0000012';
    p.sel('regBuscar').disparar('keydown', { key: 'Enter', target: p.sel('regBuscar') });
    Check('BV5 Enter con un resultado abre su detalle', [['PRB 2026-000012'], false, 'PRB 2026-000012'],
      [folios(p), p.sel('regDetFondo').hidden, p.sel('regDetTitulo').textContent]);
    p.registro.cerrarDetalle();

    p.sel('regBuscar').value = '12';
    p.sel('regBuscar').disparar('keydown', { key: 'Enter', target: p.sel('regBuscar') });
    Check('BV6 Enter con varios: solo filtra', [4, true], [folios(p).length, p.sel('regDetFondo').hidden]);

    // Cobertura: la caja se oculta y no cuenta; al volver, sigue igual.
    p.registro.verCobertura(nunca);
    Check('BV7 Cobertura: caja oculta, sin contarla', [true, '', true],
      [p.sel('regBuscarCampo').hidden, p.sel('regFiltrosCuenta').textContent, p.sel('regLimpiar').hidden]);
    p.registro.verRegistro();
    Check('BV7 de vuelta al Registro: busqueda intacta', [false, '1 filtro activo', 4],
      [p.sel('regBuscarCampo').hidden, p.sel('regFiltrosCuenta').textContent, folios(p).length]);

    p.sel('regLimpiar').disparar('click');
    Check('BV8 Limpiar filtros vacia la caja y la lista vuelve', ['', 9, ''],
      [p.sel('regBuscar').value, folios(p).length, p.sel('regFiltrosCuenta').textContent]);

    // Una tecla pendiente no revive la busqueda despues de Limpiar.
    teclear(p, '12');
    p.sel('regLimpiar').disparar('click');
    return esperarBusqueda();
  }).then(function () {
    Check('BV9 Limpiar cancela la espera pendiente', [9, ''], [folios(p).length, p.sel('regBuscar').value]);
    teclear(p, '12');
    return esperarBusqueda();
  }).then(function () {
    // Reintentar (nueva carga) conserva lo escrito.
    return p.registro.cargar(ok(DATOS_BUSQUEDA));
  }).then(function () {
    Check('BV10 recarga: la busqueda escrita se conserva', [4, '1 filtro activo'], [folios(p).length, p.sel('regFiltrosCuenta').textContent]);
  });
});

// ---------------------------------------------------------------------------
// AL) Opciones de Director / PO / SO segun el rol
//     ADM: todas (incluidos dueños heredados de registros viejos).
//     MOD o sin rol: solo nombres del catalogo vigente de dueños
//     (asignaciones = DirectorioOrganizacional.AsignacionesVigentes, ya con
//     la herencia C1 -> N2 resuelta en el servidor). VIEWER no llega aqui:
//     Admin le responde 403 (AccesoAdminHttpSmoke.cs, parte V).
// ---------------------------------------------------------------------------
var DATOS_AL = {
  estados_activos: DATOS.estados_activos, agrupadores: DATOS.agrupadores, fecha_gen: '09/10/2026',
  tipos_iniciativa: [{ prefijo: 'PRB', nombre: 'Problem' }, { prefijo: 'MAP', nombre: 'Mejora aplicativo' }],
  iniciativas: [
    Ini('PRB 2026-000001', { prefijo: 'PRB', po: 'PO 1', so: 'SO x', director: 'Dir A',
      categorias: [Cat('/A/Cat 1/Hoja', 10, 0.5, 'Dir A', 'PO 1', 'SO x')] }),
    // Su categoria resuelve dueños que solo existen en filas dadas de baja.
    Ini('MAP 2026-000002', { prefijo: 'MAP', po: 'PO Viejo', so: 'SO Viejo', director: 'Dir Viejo',
      categorias: [Cat('/Z/Baja', 5, 1, 'Dir Viejo', 'PO Viejo', 'SO Viejo')] }),
    // Sin categoria: dueños capturados en el Problem (OwnerProblem...).
    Ini('PRB 2026-000003', { prefijo: 'PRB', sin_categoria: true, categorias: [],
      po: 'Javier Tapia / Yadira Acosta', so: 'Pendiente de asignacion', director: 'Dir B' }),
    // PO del catalogo pero SO heredado del C1 (resuelto en el servidor).
    Ini('PRB 2026-000004', { prefijo: 'PRB', po: 'PO 3', so: 'SO z', director: 'Dir B',
      categorias: [Cat('/B/Cat 5', 3, 0.1, 'Dir B', 'PO 3', 'SO z')] })
  ]
};
// Catalogo vigente: la fila /B/Cat 5 tiene su SO HEREDADO del C1 (/B/Cat 4);
// el servidor ya la manda resuelta, campo por campo.
var CATALOGO_AL = { tipos: [], asignaciones: [
  { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' },
  { director: 'Dir A', po: 'PO 2', so: 'SO y', categoria: '/A/Cat 2' },
  { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 4' },
  { director: 'Dir B', po: 'PO 3', so: 'SO z', categoria: '/B/Cat 5' }
], omitidas: 0 };
var LEGADO = ['PO Viejo', 'SO Viejo', 'Dir Viejo', 'Javier Tapia / Yadira Acosta', 'Pendiente de asignacion'];
function conLegado(lista) { return lista.filter(function (v) { return LEGADO.indexOf(v) >= 0; }); }
function copiaAL() { return JSON.parse(JSON.stringify(DATOS_AL)); }
function catalogoAL(url) {
  if (/rutas=1/.test(url)) return nunca();       // el de Nueva solicitud: no se usa aqui
  return Promise.resolve(Respuesta(200, JSON.parse(JSON.stringify(CATALOGO_AL))));
}

pruebas.push(function () {
  var reg = R.Registro.desdeJson(copiaAL());
  Check('AL1 sin rol y sin catalogo: sin opciones (falla cerrado)', [[], 'catalogo'], [reg.directores(), reg.alcance]);
  reg.ampliar(CATALOGO_AL.asignaciones);
  var f = new R.FiltroRegistro(reg);
  var po = f.cascada.estado(true, '')[0].opciones, so = f.cascada.estado(true, '')[1].opciones;
  Check('AL2 MOD: directores solo del catalogo', ['Dir A', 'Dir B'], reg.directores());
  Check('AL2 MOD: PO y SO solo del catalogo', [['PO 1', 'PO 2', 'PO 3'], ['SO x', 'SO y', 'SO z']], [po, so]);
  Check('AL2 MOD: ningun nombre heredado de registros viejos', [], conLegado(reg.directores().concat(po, so)));
  Check('AL3 herencia C1 -> N2: el SO heredado (SO z) sigue como opcion de PO 3', true,
    (function () { f.elegir(0, 'PO 3'); return f.cascada.estado(true, '')[1].opciones.indexOf('SO z') >= 0; })());
  Check('AL3 ... y la categoria de la iniciativa con dueños del catalogo tambien', true,
    f.cascada.estado(true, '')[2].opciones.indexOf('/B/Cat 5') >= 0);

  // Ninguna iniciativa se pierde; filtrar sigue usando sus propias filas.
  f.limpiar();
  Check('AL4 MOD sin filtros: las 4 iniciativas siguen en la lista (incluidas las de dueños viejos)', 4, f.aplicar(reg.iniciativas).length);
  f.buscar('000003');
  Check('AL4 la de dueños del Problem se encuentra por codigo', ['PRB 2026-000003'], f.aplicar(reg.iniciativas).map(function (i) { return i.folio; }));
  f.limpiar();
  f.elegir(0, 'PO 1');
  Check('AL5 MOD filtra por un PO del catalogo', ['PRB 2026-000001'], f.aplicar(reg.iniciativas).map(function (i) { return i.folio; }));
  Check('AL5 un PO viejo no se acepta como filtro', false, f.elegir(0, 'PO Viejo'));

  // Padre -> hijo y reinicio de dependientes.
  f.limpiar();
  f.elegirDirector('Dir A');
  Check('AL6 Director acota PO', ['PO 1', 'PO 2'], f.cascada.estado(true, '')[0].opciones);
  f.elegir(0, 'PO 2');
  f.elegirDirector('Dir B');
  Check('AL6 cambiar Director reinicia un PO que ya no vale', '', f.cascada.seleccion[0]);
  f.elegirDirector('Dir Viejo');
  Check('AL6 un Director viejo no se acepta', '', f.director);

  // ADM: lo de siempre, con los nombres viejos.
  var adm = R.Registro.desdeJson(copiaAL());
  adm.fijarAlcance(true);
  var fa = new R.FiltroRegistro(adm);
  Check('AL7 ADM sin catalogo: conserva los nombres viejos', ['Dir A', 'Dir B', 'Dir Viejo'], adm.directores());
  Check('AL7 ADM: PO incluye los del Problem y los de filas dadas de baja', ['Javier Tapia / Yadira Acosta', 'PO 1', 'PO 3', 'PO Viejo'],
    fa.cascada.estado(true, '')[0].opciones);
  fa.elegir(0, 'PO Viejo');
  Check('AL7 ADM encuentra la iniciativa por el PO viejo', ['MAP 2026-000002'], fa.aplicar(adm.iniciativas).map(function (i) { return i.folio; }));
  adm.ampliar(CATALOGO_AL.asignaciones);
  Check('AL7 ADM con catalogo: suma, no quita', ['Dir A', 'Dir B', 'Dir Viejo'], adm.directores());

  Check('AL8 los datos de las iniciativas no cambian', JSON.stringify(copiaAL().iniciativas.map(function (i) { return [i.folio, i.po, i.so, i.director]; })),
    JSON.stringify(reg.iniciativas.map(function (i) { return [i.folio, i.po, i.so, i.director]; })));
});

// La pagina: MOD pide el catalogo al cargar y pinta solo esos nombres.
pruebas.push(function () {
  var pedidos = [];
  var p = Pagina(ok(copiaAL()), function (url) { pedidos.push(url); return catalogoAL(url); }, 'MOD');
  return esperar().then(esperar).then(function () {
    var cat = pedidos.filter(function (u) { return !/rutas=1/.test(u); }).length;
    Check('AL9 MOD: el catalogo se pide al cargar (sin abrir la Cobertura)', 1, cat);
    var todos = p.sel('regDirector').opciones().concat(p.sel('regPo').opciones(), p.sel('regSo').opciones());
    Check('AL9 MOD: selects sin nombres viejos', [], conLegado(todos));
    Check('AL9 MOD: Director del catalogo', ['Dir A', 'Dir B'], p.sel('regDirector').opciones());
    Check('AL9 MOD: las 4 iniciativas en la tabla', 4, folios(p).length);
    // Un ADM confirmado despues ve todo; volver a MOD lo quita y reinicia.
    p.ventana.IniciativasPagina.fijarRol('ADM');
    Check('AL10 ADM: aparecen los nombres viejos', true, p.sel('regPo').opciones().indexOf('PO Viejo') >= 0);
    elegir(p, 'regPo', 'PO Viejo');
    Check('AL10 ADM filtra por el PO viejo', ['MAP 2026-000002'], folios(p));
    p.ventana.IniciativasPagina.fijarRol('MOD');
    Check('AL10 de vuelta a MOD: sin nombres viejos y el filtro viejo se suelta', [[], 4],
      [conLegado(p.sel('regPo').opciones()), folios(p).length]);
  });
});

// Sin rol todavia y con el catalogo fallando: sin opciones, lista intacta.
pruebas.push(function () {
  var p = Pagina(ok(copiaAL()), function (url) {
    if (/rutas=1/.test(url)) return nunca();
    return Promise.resolve(Respuesta(500, { error: 'x' }));
  }, null);
  return esperar().then(esperar).then(function () {
    Check('AL11 sin rol + catalogo con error: ningun dueño ofrecido', [[], [], []],
      [p.sel('regDirector').opciones(), p.sel('regPo').opciones(), p.sel('regSo').opciones()]);
    Check('AL11 ... y las iniciativas siguen en la lista', 4, folios(p).length);
  });
});

pruebas.reduce(function (cadena, prueba) { return cadena.then(prueba); }, Promise.resolve())
  .then(function () {
    console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
    process.exit(fallos ? 1 : 0);
  }, function (err) {
    console.log('ERROR ' + (err && err.stack || err));
    process.exit(1);
  });
