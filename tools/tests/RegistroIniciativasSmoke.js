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
//   T) Tipo de iniciativa (tipo_iniciativa, no la Agrupacion): opciones del
//      registro, Todas por omision, uno, varios (O), ninguno = Todas, junto
//      con los demas filtros, Limpiar; el panel de casillas en el DOM.
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
    activa: true, seguimiento: true, sin_categoria: false, tipo_iniciativa: null, categorias: []
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
  iniciativas: [
    // Dos categorias de distinto PO; retrasada.
    Ini('PRB 2026-000001', { tipo_iniciativa: 'Problema', estado: 'En Solución', tickets_reduce: 150, vol_reduce_folio: 150, riesgo_folio: 150,
      retrazado: 1, sem_fecha: 'rojo', fecha_retrasada: true, f_solucion: '2026-09-01', n_solucion: 2,
      po: 'PO 1', so: 'SO x', director: 'Dir A', manager: 'Mgr 1',
      categorias: [Cat('/A/Cat 1/Hoja', 100, 0.5, 'Dir A', 'PO 1', 'SO x'),
                   Cat('/A/Cat 3', 50, 0.25, 'Dir A', 'PO 2', 'SO x')] }),
    Ini('MAP 2026-000002', { tipo_iniciativa: 'Mejora continua', agrup: 'Mejora', tickets_reduce: 40, vol_reduce_folio: 40,
      po: 'PO 1', so: 'SO y', director: 'Dir A',
      categorias: [Cat('/A/Cat 2', 40, 1, 'Dir A', 'PO 1', 'SO y')] }),
    // No activa
    Ini('HAR 2025-000003', { tipo_iniciativa: 'Problema', estado: 'Cerrado', activa: false, seguimiento: false, sem_fecha: 'verde',
      tickets_reduce: 30, vol_reduce_folio: 30, po: 'PO 3', so: 'SO z', director: 'Dir B',
      categorias: [Cat('/B/Cat 4', 30, 0.3, 'Dir B', 'PO 3', 'SO z')] }),
    // Activa, pero agrupacion fuera de las cuatro: no cuenta en Activas
    // (criterio de Experiencia) y retrasada no cuenta en Retrasadas.
    Ini('REQ 2026-000004', { tipo_iniciativa: 'Requerimiento', agrup: 'ReqOpr', seguimiento: false, retrazado: 1, sem_fecha: 'rojo', fecha_retrasada: true,
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

function Pagina(pedirRegistro, pedirCatalogo) {
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
    registro: ventana.IniciativasPagina.registro
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
function clicFolio(p, folio) {
  var boton = Elemento('boton');
  boton.setAttribute('data-folio', folio);
  p.sel('regCuerpo').disparar('click', { target: boton });
  return boton;
}
function visibles(p) {
  return ['regCargando', 'regError', 'regSinDatos', 'regContenido'].filter(function (id) { return !p.sel(id).hidden; });
}

var base = Pagina(nunca);
var R = base.ventana.RegistroIniciativas;
var pruebas = [];

// ---------------------------------------------------------------------------
// D) Sin DOM
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var reg = R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS)));
  Check('D1 entrada sin folio descartada', 5, reg.iniciativas.length);
  var k = R.Registro.indicadores(reg.iniciativas);
  Check('D2 indicadores: total/activas/retrasadas/no activas', [5, 3, 1, 1], [k.total, k.activas, k.retrasadas, k.noActivas]);
  Check('D2 riesgo = riesgo_folio de las retrasadas que cuentan', 150, k.riesgo);
  Check('D2 tickets a reducir de las activas', 190, k.reduceActivas);
  Check('D3 estados: activos en su orden y luego los demas', ['En Análisis', 'En Solución', 'Cerrado'], reg.estados());
  Check('D3 agrupaciones', ['Mejora', 'Problem', 'ReqOpr'], reg.tipos());
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
  f.elegirTipo('Mejora');
  Check('D11 Agrupacion', ['MAP 2026-000002'], pasan());
  Check('D12 filtros activos', 1, f.activos());

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
    Check('L5 selects llenos', [['En Análisis', 'En Solución', 'Cerrado'], ['Mejora', 'Problem', 'ReqOpr'], ['Dir A', 'Dir B'], ['PO 1', 'PO 2', 'PO 3']],
      [p.sel('regEstadoSel').opciones(), p.sel('regTipo').opciones(), p.sel('regDirector').opciones(), p.sel('regPo').opciones()]);

    elegir(p, 'regPo', 'PO 1');
    Check('L6 PO por select', ['PRB 2026-000001', 'MAP 2026-000002', 'PRB 2026-000005'], folios(p));
    Check('L6 SO acotado', ['SO w', 'SO x', 'SO y'], p.sel('regSo').opciones());
    Check('L6 indicadores siguen el filtro', ['3', '3', '1', '0'], kpis(p));
    Check('L6 cuenta con filtro', '3 de 5 iniciativas', p.sel('regCuenta').textContent);
    Check('L6 Limpiar habilitado', [false, '1 filtro activo'], [p.sel('regLimpiar').hidden, p.sel('regFiltrosCuenta').textContent]);
    elegir(p, 'regSo', 'SO y');
    elegir(p, 'regCategoria', '/A/Cat 2');
    Check('L7 PO -> SO -> Categoria', ['MAP 2026-000002'], folios(p));

    elegir(p, 'regEstadoSel', 'Cerrado');
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
    Check('E7 sin botones de editar', false, /<button/.test(html));

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
// T) Tipo de iniciativa
// ---------------------------------------------------------------------------
// PRB 1 y HAR 3: Problema; MAP 2: Mejora continua; REQ 4: Requerimiento;
// PRB 5: sin tipo (solo pasa con Todas).
pruebas.push(function () {
  var reg = R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS)));
  var f = new R.FiltroRegistro(reg);
  function pasan() { return f.aplicar(reg.iniciativas).map(function (i) { return i.folio; }); }
  var TODOS = ['Mejora continua', 'Problema', 'Requerimiento'];

  Check('T1 opciones: los tipo_iniciativa del registro, sin vacios', TODOS, reg.tiposIniciativa());
  Check('T1 no son las agrupaciones', ['Mejora', 'Problem', 'ReqOpr'], reg.tipos());
  Check('T2 por omision: Todas (null), todos marcados, sin filtro', [null, TODOS, 5, 0],
    [f.tiposIni, f.tiposIniciativa(), pasan().length, f.activos()]);

  f.alternarTipoIniciativa('Mejora continua');
  f.alternarTipoIniciativa('Requerimiento');
  Check('T3 solo Problema', [['Problema'], ['PRB 2026-000001', 'HAR 2025-000003'], 1],
    [f.tiposIni, pasan(), f.activos()]);
  f.alternarTipoIniciativa('Requerimiento');
  Check('T4 varios = O', ['PRB 2026-000001', 'HAR 2025-000003', 'REQ 2026-000004'], pasan());
  f.alternarTipoIniciativa('Inventado');
  Check('T4 tipo fuera de opciones se ignora', ['Problema', 'Requerimiento'], f.tiposIni);

  f.alternarTipoIniciativa('Problema');
  f.alternarTipoIniciativa('Requerimiento');
  Check('T5 desmarcar todos = Todas, no lista vacia', [null, 5], [f.tiposIni, pasan().length]);

  f.alternarTipoIniciativa('Problema');
  f.alternarTipoIniciativa('Problema');
  Check('T6 volver a marcarlos todos = Todas', null, f.tiposIni);
  f.alternarTipoIniciativa('Problema');
  f.todosTiposIniciativa();
  Check('T7 Todas restablece', [null, TODOS, 5], [f.tiposIni, f.tiposIniciativa(), pasan().length]);

  // Junto con los demas filtros (Y entre filtros).
  f.alternarTipoIniciativa('Mejora continua');
  f.alternarTipoIniciativa('Requerimiento');       // solo Problema
  f.elegirEstado('Cerrado');
  Check('T8 + Estado', ['HAR 2025-000003'], pasan());
  f.elegirEstado('');
  f.elegirTipo('Problem');
  Check('T8 + Agrupacion (otra columna)', ['PRB 2026-000001', 'HAR 2025-000003'], pasan());
  f.elegirTipo('Mejora');
  Check('T8 Agrupacion Mejora + tipo Problema = nada', [], pasan());
  f.elegirTipo('');
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
    Check('T10 casillas: Todas y cada tipo, todas marcadas',
      ['Todas:si', 'Mejora continua:si', 'Problema:si', 'Requerimiento:si'], casillas());
    Check('T11 panel cerrado al inicio', [true, 'false'], [p.sel('regTipoIniPanel').hidden, p.sel('regTipoIni').getAttribute('aria-expanded')]);
    p.sel('regTipoIni').disparar('click');
    Check('T11 el boton abre el panel', [false, 'true'], [p.sel('regTipoIniPanel').hidden, p.sel('regTipoIni').getAttribute('aria-expanded')]);

    marcar('data-tipo-ini', 'Mejora continua');
    marcar('data-tipo-ini', 'Requerimiento');
    Check('T12 un tipo filtra la lista', ['PRB 2026-000001', 'HAR 2025-000003'], folios(p));
    Check('T12 boton y casillas lo muestran', ['Problema', true, ['Todas:no', 'Mejora continua:no', 'Problema:si', 'Requerimiento:no']],
      [p.sel('regTipoIni').textContent, p.sel('regTipoIni').classList.contains('con-valor'), casillas()]);
    Check('T12 cuenta y Limpiar', ['1 filtro activo', false], [p.sel('regFiltrosCuenta').textContent, p.sel('regLimpiar').hidden]);
    Check('T12 el panel sigue abierto al elegir', false, p.sel('regTipoIniPanel').hidden);
    marcar('data-tipo-ini', 'Requerimiento');
    Check('T13 dos tipos (O)', [['PRB 2026-000001', 'REQ 2026-000004', 'HAR 2025-000003'], '2 de 3 tipos'],
      [folios(p), p.sel('regTipoIni').textContent]);

    elegir(p, 'regPo', 'PO 3');
    Check('T14 junto con PO', ['REQ 2026-000004', 'HAR 2025-000003'], folios(p));
    elegir(p, 'regEstadoSel', 'Cerrado');
    Check('T14 ... y Estado', ['HAR 2025-000003'], folios(p));

    p.sel('regLimpiar').disparar('click');
    Check('T15 Limpiar filtros: Todas otra vez', ['— Todas —', 5, ['Todas:si', 'Mejora continua:si', 'Problema:si', 'Requerimiento:si']],
      [p.sel('regTipoIni').textContent, folios(p).length, casillas()]);

    marcar('data-tipo-ini', 'Problema');
    Check('T16 desmarcar uno desde Todas: los otros dos; sin tipo fuera', ['REQ 2026-000004', 'MAP 2026-000002'], folios(p));
    marcar('data-tipo-todas', '');
    Check('T16 la casilla Todas restablece', ['— Todas —', 5, ''], [p.sel('regTipoIni').textContent, folios(p).length, p.sel('regFiltrosCuenta').textContent]);

    p.doc.disparar('keydown', { key: 'Escape' });
    Check('T17 Escape cierra el panel', [true, 'false'], [p.sel('regTipoIniPanel').hidden, p.sel('regTipoIni').getAttribute('aria-expanded')]);
  });
});

// ---------------------------------------------------------------------------
// V) La pagina sigue igual con el registro cargado
// ---------------------------------------------------------------------------
var CATALOGO = {
  tipos: ['Mejora'], omitidas: 0,
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
    elegir(p, 'selTipo', 'Mejora');
    elegir(p, 'selPo', 'PO 1');
    p.sel('btnVolver').disparar('click');
    elegir(p, 'regPo', 'PO 2');           // filtrar la lista no toca el borrador
    clicFolio(p, 'PRB 2026-000001');
    p.sel('selTipo').value = ''; p.sel('selPo').value = '';
    p.sel('btnSolicitar').disparar('click');
    Check('V3 borrador intacto tras usar el registro', ['Mejora', 'PO 1'], [p.sel('selTipo').value, p.sel('selPo').value]);
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
  Check('H2 CTA intacto', true, /<button type="button" class="btn ini-cta" id="btnSolicitar">/.test(html));
  Check('H3 orden de scripts', true,
    /cascada-organizacional\.js[\s\S]*registro-iniciativas\.js[\s\S]*iniciativas\.js"/.test(html));
  Check('H4 sin botones de editar/descargar', false, /(Editar|Modificar|Descargar)/.test(html));
  Check('H5 Tipo de iniciativa junto a Agrupacion, sin quitarla', true,
    /<label for="regTipo">Agrupación<\/label>[\s\S]*<label for="regTipoIni">Tipo de iniciativa<\/label>\s*<button type="button" class="ini-multi-boton" id="regTipoIni"/.test(html));

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

pruebas.reduce(function (cadena, prueba) { return cadena.then(prueba); }, Promise.resolve())
  .then(function () {
    console.log(fallos ? '\n' + fallos + ' FALLO(S)' : '\nTODO PASO');
    process.exit(fallos ? 1 : 0);
  }, function (err) {
    console.log('ERROR ' + (err && err.stack || err));
    process.exit(1);
  });
