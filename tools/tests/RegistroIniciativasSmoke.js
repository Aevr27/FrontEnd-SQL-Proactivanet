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
//   K) Indicadores sobre el registro COMPLETO: ningun filtro ni la busqueda
//      los mueve; Total = TODAS (Cerradas incluidas, 2026-10-23), abiertas
//      = estado distinto de Cerrado (sin mayusculas ni acentos; sin
//      tarjeta), Activas = seguimiento, Requerimientos = abiertas con
//      agrupacion ReqOpr (NO abiertas - Activas), Atrasadas sin cambio,
//      Cerradas = estado Cerrado (abiertas = Activas + fueraActivas y
//      abiertas + Cerradas = Total siguen en el modelo, sin tarjeta);
//      relectura con datos nuevos, cargando / error / relectura fallida sin
//      ceros, y el globo "Criterio" de Activas.
//   B) Busqueda por folio o titulo: parcial, sin mayusculas, separadores,
//      ceros ni acentos; combinada con los demas filtros, sin tocar la
//      Cobertura; espera entre teclas, Enter, Limpiar y recarga en el DOM.
//   R) Lista: columnas Código, Título, Estado, Agrupación, Tickets a
//      reducir, Fecha compromiso, Service Owner, Product Owner (cabecera y
//      celdas); "Atrasada" bajo la fecha en la misma celda; dias desde la
//      creacion bajo el codigo (= antiguedad del detalle; sin FechaCreacion
//      "Sin fecha de creación"); desglose de Fuera de Activas por motivo;
//      relectura sin tocar la vista.
//   SF) Semaforo junto a "Registro": Sin fecha (rojo), Atrasadas (ambar),
//      En tiempo (verde), Sin control de fecha (gris, solo si hay); solo
//      activas, registro completo; filtros/busqueda/orden no lo mueven;
//      relectura lo actualiza; cargando y error lo vacian.
//   O)  Orden: por omision f_creacion ascendente (sin fecha o invalida al
//      final, empates por Codigo); el orden por columna sobrevive a cada
//      filtro, la busqueda y la relectura (y reacomoda lo cambiado); clic
//      asc -> desc -> por omision; Limpiar filtros quita el orden.
//   KF) Indicadores y semaforo como filtro: cada tarjeta filtra con la
//      regla con la que cuenta; otro clic lo quita; uno a la vez; cifras
//      fijas; Y con Estado / Director / busqueda sin tocarlos; orden y
//      primera pagina; Limpiar; relectura; Cobertura; la instruccion.
//      Total (KF2T) no filtra: quita el indicador y vuelve a todas, sin
//      tocar el Director; sin aria-pressed. Mecanica en SeleccionKpi
//      (assets/js/seleccion-kpi.js, su prueba: SeleccionKpiSmoke.js).
//   Al cargar se ve TODO (Cerrado incluido): ya no hay vista por omision
//   que oculte Cerrado (L0, S2-9, BV10).
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
    // f_creacion: el orden por omision (la mas antigua primero) queda
    // PRB 1, REQ 4, MAP 2, PRB 5, HAR 3.
    Ini('PRB 2026-000001', { prefijo: 'PRB', f_creacion: '2026-01-10', estado: 'En Solución', tickets_reduce: 150, vol_reduce_folio: 150, riesgo_folio: 150,
      retrazado: 1, sem_fecha: 'rojo', fecha_retrasada: true, f_solucion: '2026-09-01', n_solucion: 2,
      po: 'PO 1', so: 'SO x', director: 'Dir A', manager: 'Mgr 1', po_capturado: 'PO 1', so_capturado: 'SO x',
      categorias: [Cat('/A/Cat 1/Hoja', 100, 0.5, 'Dir A', 'PO 1', 'SO x'),
                   Cat('/A/Cat 3', 50, 0.25, 'Dir A', 'PO 2', 'SO x')] }),
    Ini('MAP 2026-000002', { prefijo: 'MAP', f_creacion: '2026-03-10', agrup: 'Mejora', tickets_reduce: 40, vol_reduce_folio: 40,
      po: 'PO 1', so: 'SO y', director: 'Dir A', po_capturado: 'PO 1', so_capturado: 'SO y',
      categorias: [Cat('/A/Cat 2', 40, 1, 'Dir A', 'PO 1', 'SO y')] }),
    // No activa
    Ini('HAR 2025-000003', { prefijo: 'HAR', f_creacion: '2026-05-10', tipo_iniciativa: 'Mejora Aplicativo', estado: 'Cerrado', activa: false, seguimiento: false, sem_fecha: 'verde',
      tickets_reduce: 30, vol_reduce_folio: 30, po: 'PO 3', so: 'SO z', director: 'Dir B', po_capturado: 'PO 3', so_capturado: 'SO z',
      categorias: [Cat('/B/Cat 4', 30, 0.3, 'Dir B', 'PO 3', 'SO z')] }),
    // Activa, pero agrupacion fuera de las cuatro: no cuenta en Activas
    // (criterio de Experiencia) y retrasada no cuenta en Retrasadas.
    Ini('REQ 2026-000004', { prefijo: 'REQ', f_creacion: '2026-02-10', agrup: 'ReqOpr', seguimiento: false, retrazado: 1, sem_fecha: 'rojo', fecha_retrasada: true,
      f_analisis: '2026-01-01', tickets_reduce: 5, vol_reduce_folio: 5, riesgo_folio: 5,
      po: 'PO 3', so: 'SO z', director: 'Dir B', po_capturado: 'PO 3', so_capturado: 'SO z',
      categorias: [Cat('/B/Cat 5', 5, 0.1, 'Dir B', 'PO 3', 'SO z')] }),
    // Sin categoria: dueños del Problem; retrasada pero no cuenta en
    // Retrasadas (Experiencia solo las cuenta por categoria).
    Ini('PRB 2026-000005', { f_creacion: '2026-04-10', sin_categoria: true, retrazado: 1, sem_fecha: 'rojo', fecha_retrasada: true,
      f_analisis: '2026-02-01', po: 'PO 1', so: 'SO w', director: 'Dir B', po_capturado: 'PO 1', so_capturado: 'SO w', categorias: [] }),
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
  (new Function('window', leer('assets/js/duracion.js')))(ventana);
  (new Function('window', 'Escape', leer('assets/js/catalogos.js')))(ventana, ventana.Escape);
  (new Function('window', 'document', leer('assets/js/globo-ayuda.js')))(ventana, documento);
  (new Function('window', leer('admin/cascada-organizacional.js')))(ventana);
  (new Function('window', leer('admin/libro-iniciativas.js')))(ventana);
  (new Function('window', leer('assets/js/seleccion-kpi.js')))(ventana);
  (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', 'fetch', leer('admin/registro-iniciativas.js')))(
    ventana, documento, ventana.Catalogos, ventana.Escape, ventana.Duracion, pedir);
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
// Al cargar ya se ve todo (Cerrado incluido). "Limpiar" deja la vista
// igual de limpia; las pruebas lo siguen usando para partir de cero.
function sinOmision(p) { p.sel('regLimpiar').disparar('click'); }
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
  Check('D2 indicadores: total (abiertas)/abiertas/activas/fuera de activas/retrasadas/cerradas', [4, 4, 3, 1, 1, 1],
    [k.total, k.abiertas, k.activas, k.fueraActivas, k.retrasadas, k.cerradas]);
  Check('D2 sin categoria entre todas', 1, k.sinCategoria);
  Check('D2 riesgo = riesgo_folio de las retrasadas que cuentan', 150, k.riesgo);
  Check('D2 tickets a reducir de las activas', 190, k.reduceActivas);
  Check('D3 estados: activos en su orden y luego los demas', ['En Análisis', 'En Solución', 'Cerrado'], reg.estados());
  Check('D3 Agrupacion ya no es filtro: sin opciones en Registro', 'undefined', typeof reg.tipos);
  Check('D3 directores (incluye el del Problem sin categoria)', ['Dir A', 'Dir B'], reg.directores());
  Check('D4 sin lista lanza', true, (function () { try { R.Registro.desdeJson({}); return false; } catch (e) { return true; } })());

  var f = new R.FiltroRegistro(reg);
  function pasan() { return f.aplicar(reg.iniciativas).map(function (i) { return i.folio; }); }
  Check('D5 sin filtros pasan todas', 5, pasan().length);

  // PO / SO del filtro = los CAPTURADOS de la iniciativa (po_capturado /
  // so_capturado), no los de sus categorias. PO 2 solo es dueño de la
  // SEGUNDA categoria de PRB 1 (capturado: PO 1): ya no es opcion ni la
  // encuentra.
  Check('D6 PO de una categoria que nadie capturo no es opcion', false, f.elegir(0, 'PO 2'));
  Check('D6 ... y no filtra', 5, pasan().length);
  f.elegir(0, 'PO 1');
  Check('D6 PO 1: los que lo capturaron, con y sin categoria',
    ['PRB 2026-000001', 'MAP 2026-000002', 'PRB 2026-000005'], pasan());
  var e = f.cascada.estado(true, '');
  Check('D7 progresivo: SO capturados con PO 1', ['SO w', 'SO x', 'SO y'], e[1].opciones);
  // PRB 1 capturo PO 1: TODAS sus categorias quedan bajo PO 1 (tambien
  // /A/Cat 3, cuya categoria es de PO 2).
  Check('D7 progresivo: Categorias de PO 1', ['/A/Cat 1/Hoja', '/A/Cat 2', '/A/Cat 3'], e[2].opciones);
  f.elegir(1, 'SO y');
  Check('D7 PO 1 + SO y', ['MAP 2026-000002'], pasan());
  Check('D7 categorias de PO 1 + SO y', ['/A/Cat 2'], f.cascada.estado(true, '')[2].opciones);
  // La misma fila debe cumplir todo: PO 3 + /A/Cat 2 no existe.
  f.limpiar();
  f.elegir(0, 'PO 3');
  Check('D8 combinacion inexistente no se ofrece', ['/B/Cat 4', '/B/Cat 5'], f.cascada.estado(true, '')[2].opciones);
  Check('D8 valor fuera de opciones no se acepta', false, f.elegir(2, '/A/Cat 2'));

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
  Check('D13 orden por omision: fecha de creacion, la mas antigua primero',
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
    Check('L0 al cargar: Todas (Cerrado incluido), sin filtro activo, indicadores del registro completo',
      [['PRB 2026-000001', 'REQ 2026-000004', 'MAP 2026-000002', 'PRB 2026-000005', 'HAR 2025-000003'], ['4', '3', '1', '1', '1'], '5 iniciativas',
       '— Todos —', ['Todos:si', 'En Análisis:si', 'En Solución:si', 'Cerrado:si'], '', true],
      [folios(p), kpis(p), p.sel('regCuenta').textContent, p.sel('regEstado').textContent, casillasDe(p, 'regEstadoPanel'),
       p.sel('regFiltrosCuenta').textContent, p.sel('regLimpiar').hidden]);
    sinOmision(p);
    Check('L0 Limpiar: tambien las cerradas', 5, folios(p).length);
    Check('L1 listo: contenido visible', ['regContenido'], visibles(p));
    Check('L1 cinco filas, en el orden por omision',
      ['PRB 2026-000001', 'REQ 2026-000004', 'MAP 2026-000002', 'PRB 2026-000005', 'HAR 2025-000003'], folios(p));
    Check('L2 indicadores: Total, Activas, Requerimientos, Atrasadas, Cerradas', ['4', '3', '1', '1', '1'], kpis(p));
    Check('L2 pie de retrasadas', true, /150 tickets en riesgo/.test(p.sel('regKpis').innerHTML));
    var html = p.sel('regCuerpo').innerHTML;
    Check('L3 atrasada: fecha en rojo y la palabra debajo, sin pintar la fila', [true, false],
      [/ini-vencida">01\/09\/2026<\/b><span class="ini-retraso">Atrasada/.test(html), /<tr class="[^"]*(vencid|rojo)/.test(html)]);
    // PO / SO de la columna: el CAPTURADO de la iniciativa (uno), aunque sus
    // categorias tengan dueños distintos (PRB 1: PO 1 y PO 2).
    Check('L3 PO de la columna: el capturado, sin +N de categorias', [true, false],
      [/data-folio="PRB 2026-000001"[\s\S]*?data-col="Product Owner" class="ini-col-persona">PO 1<\/td>/.test(html), /ini-mas/.test(html)]);
    Check('L3 sin categoria marcada', true, /Sin categoría/.test(html));
    Check('L3 no activa sin fecha compromiso', true,
      /data-folio="HAR 2025-000003"[\s\S]*?ini-sem verde[^>]*><\/span><span class="ini-tenue">—/.test(html));
    Check('L4 cuenta', '5 iniciativas', p.sel('regCuenta').textContent);
    Check('L4 sin "Mostrar mas"', true, p.sel('regMas').hidden);
    // PO: los capturados (PO 2 solo es dueño de una categoria: no sale).
    Check('L5 filtros llenos', [['Todos:si', 'En Análisis:si', 'En Solución:si', 'Cerrado:si'], ['Dir A', 'Dir B'], ['PO 1', 'PO 3']],
      [casillasDe(p, 'regEstadoPanel'), p.sel('regDirector').opciones(), p.sel('regPo').opciones()]);
    Check('L5 el select de Agrupacion no se llena', '', p.sel('regTipo').innerHTML);
    Check('L5 la columna Agrupacion sigue en la tabla', true, /data-col="Agrupación"><span class="chip ini-chip">Mejora/.test(html));

    elegir(p, 'regPo', 'PO 1');
    Check('L6 PO por select', ['PRB 2026-000001', 'MAP 2026-000002', 'PRB 2026-000005'], folios(p));
    Check('L6 SO acotado', ['SO w', 'SO x', 'SO y'], p.sel('regSo').opciones());
    Check('L6 indicadores NO siguen el filtro', ['4', '3', '1', '1', '1'], kpis(p));
    Check('L6 cuenta con filtro', '3 de 5 iniciativas', p.sel('regCuenta').textContent);
    Check('L6 Limpiar habilitado', [false, '1 filtro activo'], [p.sel('regLimpiar').hidden, p.sel('regFiltrosCuenta').textContent]);
    elegir(p, 'regSo', 'SO y');
    elegir(p, 'regCategoria', '/A/Cat 2');
    Check('L7 PO -> SO -> Categoria', ['MAP 2026-000002'], folios(p));

    soloEstado(p, 'Cerrado');
    Check('L8 sin coincidencias: aviso, sin tabla', [false, true, ''], [p.sel('regVacio').hidden, p.sel('regTablaCaja').hidden, p.sel('regCuenta').textContent]);
    Check('L8 lista vacia por filtro: los indicadores no cambian', ['4', '3', '1', '1', '1'], kpis(p));
    p.sel('regLimpiarVacio').disparar('click');
    Check('L9 limpiar', [5, true, ''], [folios(p).length, p.sel('regVacio').hidden, p.sel('regPo').value]);

    p.sel('regCabeza').disparar('click', { target: (function () { var b = Elemento('th'); b.setAttribute('data-orden', 'folio'); return b; })() });
    Check('L10 ordenar por Codigo', 'HAR 2025-000003', folios(p)[0]);
    Check('L10 aria-sort', true, /aria-sort="ascending"><button type="button" class="ini-orden" data-orden="folio"/.test(p.sel('regCabeza').innerHTML));

    // "Mostrar mas" con mas de una pagina
    var muchas = JSON.parse(JSON.stringify(DATOS));
    for (var n = 0; n < 230; n++) muchas.iniciativas.push(Ini('X ' + (1000 + n), { categorias: [Cat('/A/Cat 2', 1, 0.1, 'Dir A', 'PO 1', 'SO y')] }));
    return p.registro.cargar(ok(muchas)).then(function () {
      sinOmision(p);   // una carga nueva vuelve a la vista por omision
      Check('L11 primera pagina', [100, false], [folios(p).length, p.sel('regMas').hidden]);
      Check('L11 cuenta', '235 iniciativas · mostrando 100', p.sel('regCuenta').textContent);
      p.sel('regMas').disparar('click');
      p.sel('regMas').disparar('click');
      Check('L11 todas', [235, true], [folios(p).length, p.sel('regMas').hidden]);
    });
  });
});

// ---------------------------------------------------------------------------
// EC) PO / SO capturados en la iniciativa (alta de Admin, sql/20): con
//     categorias van aparte de los de sus categorias; sin capturar, no se
//     pinta nada nuevo.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var d = JSON.parse(JSON.stringify(DATOS));
  d.iniciativas.forEach(function (i) {
    if (i.folio === 'PRB 2026-000001') { i.po_capturado = 'PO Capturado <x>'; i.so_capturado = null; }
    if (i.folio === 'MAP 2026-000002') { i.po_capturado = null; i.so_capturado = null; }
  });
  var p = Pagina(ok(d));
  return esperar().then(function () {
    clicFolio(p, 'PRB 2026-000001');
    var html = p.sel('regDetCuerpo').innerHTML;
    Check('EC1 con categorias: PO capturado aparte (escapado), SO capturado vacio = guion', [true, true, true],
      [/Product Owner capturado<\/dt><dd>PO Capturado &lt;x&gt;</.test(html), /Service Owner capturado<\/dt><dd>—</.test(html),
       /alta o edición de ADM\): son los de las columnas y los filtros de la lista/.test(html)]);
    clicFolio(p, 'MAP 2026-000002');
    Check('EC2 sin capturar: sin bloque nuevo', false, /capturado/.test(p.sel('regDetCuerpo').innerHTML));
  });
});

// ---------------------------------------------------------------------------
// PC) Columnas, orden y filtro PO / SO de la lista = los CAPTURADOS de la
//     iniciativa (po_capturado / so_capturado = dbo.Problem.OwnerProblem /
//     OwnerServicio), no los de sus categorias. Tras guardar (actualizar),
//     la lista muestra y filtra lo recien leido; las categorias no cambian.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var d = JSON.parse(JSON.stringify(DATOS));
  d.iniciativas.forEach(function (i) {
    // Capturado distinto de los dueños de su categoria (PO 1 / SO y).
    if (i.folio === 'MAP 2026-000002') { i.po_capturado = 'PO Nuevo'; i.so_capturado = 'SO Nuevo'; }
    // Sin capturar (null y solo espacios).
    if (i.folio === 'REQ 2026-000004') { i.po_capturado = null; i.so_capturado = '   '; }
  });
  var p = Pagina(ok(d));
  var reg;
  function porFolio(f) { return reg.registro.buscar(f); }
  return esperar().then(function () {
    reg = p.registro;
    sinOmision(p);
    Check('PC1 columnas: el capturado, no el de la categoria', [true, true, false],
      [/>PO Nuevo$/.test(celda(p, 'MAP 2026-000002', 'Product Owner')), />SO Nuevo$/.test(celda(p, 'MAP 2026-000002', 'Service Owner')),
       />PO 1$/.test(celda(p, 'MAP 2026-000002', 'Product Owner'))]);
    Check('PC2 sin capturar: guion en las dos columnas', [true, true],
      [/ini-tenue">—<\/span>$/.test(celda(p, 'REQ 2026-000004', 'Product Owner')), /ini-tenue">—<\/span>$/.test(celda(p, 'REQ 2026-000004', 'Service Owner'))]);
    Check('PC3 opciones de PO / SO: los capturados (sin vacios)', [['PO 1', 'PO 3', 'PO Nuevo'], ['SO Nuevo', 'SO w', 'SO x', 'SO z']],
      [p.sel('regPo').opciones(), p.sel('regSo').opciones()]);
    elegir(p, 'regPo', 'PO Nuevo');
    Check('PC4 filtrar por el PO capturado la encuentra', ['MAP 2026-000002'], folios(p));
    elegir(p, 'regPo', 'PO 1');
    Check('PC4 el PO de su categoria (PO 1) ya no la trae', ['PRB 2026-000001', 'PRB 2026-000005'], folios(p));
    elegir(p, 'regPo', 'PO 3');
    Check('PC5 sin capturar no pasa un PO elegido', ['HAR 2025-000003'], folios(p));
    elegir(p, 'regPo', '');
    elegir(p, 'regSo', 'SO Nuevo');
    Check('PC5 SO capturado filtra igual', ['MAP 2026-000002'], folios(p));
    sinOmision(p);
    Check('PC5 sin filtro, las sin capturar siguen en la lista', 5, folios(p).length);

    // Lo que se ve en la columna = lo que filtra, en cada fila.
    var coinciden = reg.registro.iniciativas.every(function (i) {
      var f = new R.FiltroRegistro(reg.registro);
      var po = (i.po_capturado || '').trim();
      if (!po) return true;
      f.elegir(0, po);
      return f.aplicar(reg.registro.iniciativas).some(function (x) { return x.folio === i.folio; }) &&
        new RegExp('>' + po + '$').test(celda(p, i.folio, 'Product Owner'));
    });
    Check('PC6 cada PO de la columna es una opcion del filtro que encuentra su fila', true, coinciden);

    reg.ordenarPor('po');
    Check('PC7 ordenar por Product Owner: por el capturado, sin capturar al final',
      ['PRB 2026-000001', 'PRB 2026-000005', 'HAR 2025-000003', 'MAP 2026-000002', 'REQ 2026-000004'], folios(p));
    reg.ordenarPor('po'); reg.ordenarPor('po');

    // Guardado de ADM (otro PO / SO capturado) y relectura.
    elegir(p, 'regPo', 'PO Nuevo');
    var json = JSON.parse(JSON.stringify(d));
    json.iniciativas.forEach(function (i) {
      if (i.folio === 'MAP 2026-000002') { i.po_capturado = 'PO 3'; i.so_capturado = 'SO z'; }
    });
    return reg.actualizar(ok(json));
  }).then(function () {
    Check('PC8 tras guardar: la columna muestra lo guardado', [true, true],
      [/>PO 3$/.test(celda(p, 'MAP 2026-000002', 'Product Owner')), />SO z$/.test(celda(p, 'MAP 2026-000002', 'Service Owner'))]);
    Check('PC8 el PO viejo ya no es opcion (el filtro se suelta) y el nuevo la encuentra', [false, ['HAR 2025-000003', 'MAP 2026-000002']],
      [p.sel('regPo').opciones().indexOf('PO Nuevo') >= 0, (elegir(p, 'regPo', 'PO 3'), folios(p).sort())]);
    var map = porFolio('MAP 2026-000002'), prb = porFolio('PRB 2026-000001');
    Check('PC9 los dueños de su categoria no cambian', ['PO 1', 'SO y', 'Dir A'], [map.categorias[0].po, map.categorias[0].so, map.categorias[0].director]);
    Check('PC9 otra iniciativa no cambia', ['PO 1', 'SO x', 'PO 1', 'PO 2'],
      [prb.po_capturado, prb.so_capturado, prb.categorias[0].po, prb.categorias[1].po]);
    clicFolio(p, 'MAP 2026-000002');
    Check('PC10 el detalle sigue mostrando los dueños de la categoria aparte', [true, true],
      [/Product Owner<\/dt><dd>PO 1</.test(p.sel('regDetCuerpo').innerHTML), /Product Owner capturado<\/dt><dd>PO 3</.test(p.sel('regDetCuerpo').innerHTML)]);
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
    Check('E2 secciones', ['Identificación', 'Impacto', 'Organización', 'Seguimiento', 'Descripción', 'Categorías afectadas'],
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
    Check('S2-9 listo: por omision Todos, Cerrado incluido', ['— Todos —', '', false, false],
      [p.sel('regEstado').textContent, p.sel('regEstado').getAttribute('title'), p.sel('regEstado').disabled,
       p.sel('regEstado').classList.contains('con-valor')]);
    Check('S2-9 casillas: Todos y cada estado (activos primero), Cerrado marcado',
      ['Todos:si', 'En Análisis:si', 'En Solución:si', 'Cerrado:si'], casillasDe(p, 'regEstadoPanel'));
    sinOmision(p);
    Check('S2-9 Limpiar: Todos', ['— Todos —', false, ['Todos:si', 'En Análisis:si', 'En Solución:si', 'Cerrado:si']],
      [p.sel('regEstado').textContent, p.sel('regEstado').classList.contains('con-valor'), casillasDe(p, 'regEstadoPanel')]);
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
// SE) Solicitar cambios: la fecha nombra su etapa; Estado va solo (sin fecha)
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var conEstados = JSON.parse(JSON.stringify(DATOS));
  conEstados.estados_problem = ['En Análisis', 'En Solución', 'Cerrado'];
  conEstados.subestados_problem = ['Solucionado'];
  var peticiones = [];
  var p = Pagina(ok(conEstados), function (url) { peticiones.push(url); return nunca(); });
  function accion(a) {
    var el = Elemento('b'); el.setAttribute('data-accion', a);
    p.sel('regDetCuerpo').disparar('click', { target: el });
  }
  function elegir(id, v) { p.sel(id).value = v; p.sel('regDetCuerpo').disparar('change', { target: p.sel(id) }); }
  return esperar().then(function () {
    peticiones.length = 0;
    clicFolio(p, 'PRB 2026-000001');
    accion('solicitar-cambios');
    Check('SE1 la fecha nombra su etapa (la del campo elegido)', true,
      /<label for="regCambioNueva" id="regCambioNuevaRot">Nueva fecha compromiso de Solución<\/label>/.test(p.sel('regCambio').innerHTML));
    elegir('regCambioFechaCampo', 'f_cierre');
    Check('SE1 ... y cambia con la etapa de "Fecha de compromiso"', 'Nueva fecha compromiso de Cierre', p.sel('regCambioNuevaRot').textContent);
    elegir('regCambioCampo', '');
    Check('SE2 sin "Qué cambiar" no hay fecha suelta', [true, true], [p.sel('regCambioGrupoFecha').hidden, p.sel('regCambioGrupoEtapa').hidden]);
    Check('SE2 CSS: [hidden] gana al display:flex de .campo (solo se ve el grupo elegido)', true,
      /\.ini-cambio-campos \.campo\[hidden\][^{]*\{ display: none; \}/.test(leer('admin/iniciativas.css')));

    elegir('regCambioCampo', 'estado');
    var form = p.sel('regCambio').innerHTML;
    var grupo = form.slice(form.indexOf('id="regCambioGrupoEstado"'), form.indexOf('id="regCambioGrupoPct"'));
    Check('SE3 con Estado: solo el nuevo Estado; ni fecha opcional ni Subestado', [false, true, false, false, false],
      [p.sel('regCambioGrupoEstado').hidden, /<label for="regCambioEstado">Nuevo Estado<\/label>/.test(grupo),
       /regCambioEstFecha|type="date"|f_analisis|f_solucion|f_cierre/.test(grupo), /también cambia/.test(form), /Subestado/.test(grupo)]);
    Check('SE3 con Estado: la etapa y la nueva fecha de "Fecha de compromiso" quedan ocultas', [true, true],
      [p.sel('regCambioGrupoEtapa').hidden, p.sel('regCambioGrupoFecha').hidden]);

    p.sel('regCambioEstado').value = 'Cerrado';
    // Aunque quede escrita una fecha en la caja de Fecha de compromiso, con
    // Estado no viaja.
    p.sel('regCambioNueva').value = '2026-11-30';
    p.sel('regCambioMotivo').value = 'Se cierra';
    accion('cambio-agregar');
    accion('cambio-preparar');
    var msg = p.sel('regCambioMsg').innerHTML;
    Check('SE4 Estado solo, preparada y NO enviada, sin fecha', ['ini-cambio-msg listo', true, true, false],
      [p.sel('regCambioMsg').className, /Solicitud preparada, no enviada/.test(msg), /En Solución → Cerrado/.test(msg), /Fecha compromiso|30\/11\/2026/.test(msg)]);
    Check('SE4 ninguna peticion y el registro no cambia', [[], 'En Solución', '2026-09-01'],
      [peticiones, p.registro.registro.buscar('PRB 2026-000001').estado, p.registro.registro.buscar('PRB 2026-000001').f_solucion]);
    Check('SE5 los pares de Estado no llevan fecha', [false, false],
      ['campo_fecha', 'fecha_nueva'].map(function (k) { return p.registro.lista.pares().some(function (x) { return x[0] === k; }); }));
  });
});

// ---------------------------------------------------------------------------
// PS) "Solicitar cambios" del PO / SO sin rol (sql/37): el boton sale SOLO
// en los folios que el servidor mando en cambios_pso; en los demas, solo
// lectura. Que el servidor decida de verdad (y ponga el rol PSO) lo prueba
// SolicitudesCambioHttpSmoke.cs (P).
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var datos = JSON.parse(JSON.stringify(DATOS));
  datos.estados_problem = ['En An\u00e1lisis', 'En Soluci\u00f3n', 'Cerrado'];
  datos.cambios_pso = ['PRB 2026-000001', 42, ''];
  var p = Pagina(ok(datos), function () { return nunca(); }, null);
  function accion(a) {
    var el = Elemento('b'); el.setAttribute('data-accion', a);
    p.sel('regDetCuerpo').disparar('click', { target: el });
  }
  return esperar().then(function () {
    Check('PS0 cambios_pso: solo textos', ['PRB 2026-000001'], p.registro.registro.cambiosPso);
    clicFolio(p, 'PRB 2026-000001');
    Check('PS1 sin rol, iniciativa propia: hay boton y Solicitar cambios abre', [true, true],
      [/id="regCambioBoton"/.test(p.sel('regDetCuerpo').innerHTML), (accion('solicitar-cambios'), /regCambioCampo/.test(p.sel('regCambio').innerHTML))]);
    Check('PS2 sin rol: tampoco ofrece Subestado', false, /regCambioSubestado|Subestado/.test(p.sel('regCambio').innerHTML));
    clicFolio(p, 'PRB 2026-000005');
    accion('solicitar-cambios');
    Check('PS3 sin rol, iniciativa ajena: sin boton y no abre', [false, false, null],
      [/id="regCambioBoton"/.test(p.sel('regDetCuerpo').innerHTML), p.registro.cambioAbierto, p.registro.lista || null]);
  });
});
pruebas.push(function () {
  var p = Pagina(ok(JSON.parse(JSON.stringify(DATOS))), function () { return nunca(); }, null);
  return esperar().then(function () {
    clicFolio(p, 'PRB 2026-000001');
    Check('PS4 sin cambios_pso (servidor viejo o sin sql/37): sin boton', false, /id="regCambioBoton"/.test(p.sel('regDetCuerpo').innerHTML));
  });
});

// ---------------------------------------------------------------------------
// SB) Subestado (2026-10-26): "Solicitar cambios" NO lo ofrece a nadie (ni
// la opcion "Estado y Subestado", ni el actual, ni el nuevo); el Estado se
// sigue pidiendo. ADM conserva la lista para "Modificar" (opcionesEstado);
// MOD y sin rol, no. Que MOD no lo pueda pedir por HTTP lo prueba
// SolicitudesCambioHttpSmoke.cs (S1-S5). Sin rol (2026-10-28) ni siquiera
// se abre "Solicitar cambios": el registro es de solo lectura.
// ---------------------------------------------------------------------------
[['ADM', true], ['MOD', false], [null, false]].forEach(function (caso) {
  pruebas.push(function () {
    var datos = JSON.parse(JSON.stringify(DATOS));
    datos.estados_problem = ['En Análisis', 'En Solución', 'Cerrado'];
    datos.subestados_problem = ['Solucionado'];
    datos.iniciativas[0].subestado = 'En espera';
    var p = Pagina(ok(datos), function () { return nunca(); }, caso[0]);
    var nombre = caso[0] || 'sin rol';
    function accion(a) {
      var el = Elemento('b'); el.setAttribute('data-accion', a);
      p.sel('regDetCuerpo').disparar('click', { target: el });
    }
    function elegir(id, v) { p.sel(id).value = v; p.sel('regDetCuerpo').disparar('change', { target: p.sel(id) }); }
    return esperar().then(function () {
      Check('SB0 ' + nombre + ': la lista de Subestados ' + (caso[1] ? 'sigue para Modificar' : 'no llega'), caso[1] ? ['Solucionado'] : [],
        p.registro.opcionesEstado().subestados);
      clicFolio(p, 'PRB 2026-000001');
      accion('solicitar-cambios');
      var form = p.sel('regCambio').innerHTML;
      if (!caso[0]) {
        Check('SB1 sin rol: sin boton y Solicitar cambios no abre (solo lectura)', [false, false, null],
          [/id="regCambioBoton"/.test(p.sel('regDetCuerpo').innerHTML), /regCambioCampo/.test(form), p.registro.lista || null]);
        return;
      }
      Check('SB1 ' + nombre + ': ni la opcion "Estado y Subestado" ni campo de Subestado; la opcion es "Estado"', [false, false, true],
        [/Subestado/.test(form), /regCambioSubestado/.test(form), /<option value="estado">Estado<\/option>/.test(form)]);
      elegir('regCambioCampo', 'estado');
      Check('SB1 ' + nombre + ': el valor actual es solo el Estado (sin Subestado)', 'En Solución', p.sel('regCambioActual').textContent);
      p.sel('regCambioEstado').value = 'Cerrado';
      p.sel('regCambioMotivo').value = 'Se cierra';
      // Aunque algo escriba un Subestado en el borrador, no viaja.
      p.registro.cambio.subestado = 'Solucionado';
      accion('cambio-agregar');
      accion('cambio-preparar');
      Check('SB2 ' + nombre + ': el cambio de Estado se prepara igual, sin Subestado', [true, true, false],
        [/ini-cambio-msg listo/.test(p.sel('regCambioMsg').className), /En Solución → Cerrado/.test(p.sel('regCambioMsg').innerHTML),
         /Solucionado|En espera/.test(p.sel('regCambioMsg').innerHTML + p.sel('regCambioLista').innerHTML)]);
      Check('SB2 ' + nombre + ': los pares de envio no llevan subestado_nuevo', false,
        p.registro.lista.pares().some(function (x) { return x[0] === 'subestado_nuevo'; }));
    });
  });
});

pruebas.push(function () {
  // Descarga con MOD: sin la columna Subestado (ADM la tiene: XD3).
  var p = Pagina(ok(DATOS), null, 'MOD'), reg = p.registro, b = Bajada();
  return esperar().then(function () {
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function (r) {
    var enc = XLSXV.utils.sheet_to_json(b.libro().Sheets.Iniciativas, { header: 1 })[0];
    Check('SB3 MOD: el Excel no trae la columna Subestado; Estado y Agrupacion siguen', [true, false, true, true],
      [r, enc.indexOf('Subestado') >= 0, enc.indexOf('Estado') >= 0, enc.indexOf('Agrupación') === enc.indexOf('Estado') + 1]);
  });
});

// ---------------------------------------------------------------------------
// SV) Enviar la solicitud (persistencia_solicitudes = true): solo "enviada"
// con el numero de la base; la misma llave al reintentar; sin quien envia.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var datos = JSON.parse(JSON.stringify(DATOS));
  datos.estados_problem = ['En Análisis', 'En Solución', 'Cerrado'];
  datos.persistencia_solicitudes = true;
  var p = Pagina(ok(datos), function () { return nunca(); });
  function accion(a) {
    var el = Elemento('b'); el.setAttribute('data-accion', a);
    p.sel('regDetCuerpo').disparar('click', { target: el });
  }
  function elegir(id, v) { p.sel(id).value = v; p.sel('regDetCuerpo').disparar('change', { target: p.sel(id) }); }
  var envios = [], respuestas = [];
  function responder(status, json) { respuestas.push(function () { return Promise.resolve({ status: status, json: function () { return Promise.resolve(json); } }); }); }
  return esperar().then(function () {
    p.registro.pedirSolicitud = function (url, op) {
      var campos = {};
      op.body.forEach(function (v, k) { campos[k] = campos[k] === undefined ? v : [].concat(campos[k], v); });
      envios.push({ url: url, metodo: op.method, campos: campos });
      var r = respuestas.shift();
      return r ? r() : Promise.reject(new Error('sin red'));
    };
    clicFolio(p, 'PRB 2026-000001');
    accion('solicitar-cambios');
    Check('SV1 con el registro habilitado el boton dice Enviar', true,
      /id="regCambioEnviar" data-accion="cambio-preparar">Enviar solicitud</.test(p.sel('regCambio').innerHTML));
    elegir('regCambioCampo', 'estado');
    p.sel('regCambioEstado').value = 'Cerrado';
    p.sel('regCambioMotivo').value = 'Se cierra';
    responder(500, { enviada: null, tipo: 'EnvioNoConfirmado', error: 'Tiempo agotado.' });
    accion('cambio-agregar');
    accion('cambio-preparar');
    Check('SV1b "Enviar solicitud" primero muestra la lista para revisarla; nada viaja sin confirmar', [0, 'ini-cambio-msg revisar', true, true],
      [envios.length, p.sel('regCambioMsg').className, /En Solución → Cerrado/.test(p.sel('regCambioMsg').innerHTML),
       /data-accion="cambio-confirmar">Confirmar y enviar</.test(p.sel('regCambioMsg').innerHTML)]);
    accion('cambio-confirmar');
    accion('cambio-confirmar');   // doble clic: una sola peticion
    return esperar().then(esperar).then(function () {
      Check('SV1c doble clic en Confirmar: UNA peticion', 1, envios.length);
      var e = envios[0];
      Check('SV2 POST a ?accion=enviar con el tipo, el Estado y el motivo; sin fecha, usuario ni rol',
        ['../handlers/admin_iniciativas_solicitudes.ashx?accion=enviar', 'POST', 'PRB 2026-000001', 'estado', 'Cerrado', undefined, undefined, 'Se cierra', true, false, false],
        [e.url, e.metodo, e.campos.folio, e.campos.tipo, e.campos.estado_nuevo, e.campos.campo_fecha, e.campos.fecha_nueva, e.campos.motivo,
         /^[0-9a-f-]{36}$/.test(e.campos.llave), 'usuario' in e.campos, 'rol' in e.campos]);
      Check('SV3 sin confirmacion: aviso, NO dice enviada, se puede reintentar', ['ini-cambio-msg aviso', false, true, false],
        [p.sel('regCambioMsg').className, /enviada/i.test(p.sel('regCambioMsg').innerHTML.replace(/no se sabe si se envió/, '')), /no se duplica/.test(p.sel('regCambioMsg').innerHTML), p.sel('regCambioEnviar').disabled]);
      Check('SV3b sin confirmar: la lista queda fija (el reintento lleva lo mismo)', [true, false, 1],
        [p.registro.lista.bloqueada(), p.registro.accionItemCambio('quitar|0'), p.registro.lista.items.length]);
      responder(200, { enviada: true, id_solicitud: 12, repetida: true });
      accion('cambio-preparar');
      return esperar().then(esperar);
    }).then(function () {
      Check('SV4 el reintento usa la MISMA llave', envios[0].campos.llave, envios[1].campos.llave);
      Check('SV5 enviada SOLO con el numero de la base (y dice si ya estaba)', ['ini-cambio-msg listo', true, true, true],
        [p.sel('regCambioMsg').className, /Solicitud #12 enviada/.test(p.sel('regCambioMsg').innerHTML), /no se duplicó/.test(p.sel('regCambioMsg').innerHTML),
         /la iniciativa no cambia hasta que la aplique/.test(p.sel('regCambioMsg').innerHTML)]);
      accion('cambio-preparar');
      return esperar();
    }).then(function () {
      Check('SV6 ya enviada: otro clic no manda nada; el registro no cambio', [2, 'En Solución'],
        [envios.length, p.registro.registro.buscar('PRB 2026-000001').estado]);
      accion('cambio-cancelar');
      accion('solicitar-cambios');
      elegir('regCambioCampo', 'fecha');
      elegir('regCambioFechaCampo', 'f_cierre');
      p.sel('regCambioNueva').value = '2027-02-01';
      p.sel('regCambioMotivo').value = 'otra';
      responder(501, { enviada: false, tipo: 'PersistenciaNoHabilitada', error: 'Falta aplicar sql/22.' });
      accion('cambio-agregar');
      accion('cambio-preparar');
      accion('cambio-confirmar');
      return esperar().then(esperar);
    }).then(function () {
      Check('SV7 borrador nuevo = llave nueva; 501 dice que no se envio', [true, 'ini-cambio-msg aviso', true],
        [envios[2].campos.llave !== envios[0].campos.llave, p.sel('regCambioMsg').className, /No se envió/.test(p.sel('regCambioMsg').innerHTML)]);
      Check('SV7 "Fecha de compromiso" viaja con el contrato de siempre: tipo fecha + campo_fecha de la etapa elegida',
        ['fecha', 'f_cierre', '2027-02-01', undefined, undefined],
        [envios[2].campos.tipo, envios[2].campos.campo_fecha, envios[2].campos.fecha_nueva, envios[2].campos.estado_nuevo, envios[2].campos.subestado_nuevo]);
      Check('SV7b 501 es definitivo: la lista se puede volver a editar', false, p.registro.lista.bloqueada());
      responder(422, { enviada: false, errores: [{ campo: 'fecha_nueva', mensaje: 'La nueva fecha compromiso es igual a la actual.' }] });
      accion('cambio-preparar');
      accion('cambio-confirmar');
      return esperar().then(esperar);
    }).then(function () {
      Check('SV8 422: los errores del servidor, tal cual', ['ini-cambio-msg error', true],
        [p.sel('regCambioMsg').className, /igual a la actual/.test(p.sel('regCambioMsg').innerHTML)]);
      accion('cambio-preparar');
      accion('cambio-confirmar');   // sin respuesta preparada: la red falla
      return esperar().then(esperar);
    }).then(function () {
      Check('SV9 sin red: aviso de que no se sabe, reintento posible', ['ini-cambio-msg aviso', true, false],
        [p.sel('regCambioMsg').className, /no se sabe si se envió/.test(p.sel('regCambioMsg').innerHTML), p.sel('regCambioEnviar').disabled]);
    });
  });
});

// ---------------------------------------------------------------------------
// SL) "Solicitar cambios" como lista: varios cambios, UNA solicitud. Sin
// repetir lo que choca; Editar sin duplicar; Quitar; el Motivo se queda;
// atajo Estado -> Fecha de compromiso; y solo viaja lo que el contrato de
// hoy guarda como UNA solicitud (nunca por partes ni una tras otra).
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var L = R.ListaSolicitudCambio, S = R.SolicitudCambio;
  var reg = Adm(R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS))));
  var ini = reg.buscar('PRB 2026-000001');
  var OP = { estados: ['En Análisis', 'En Solución', 'En Monitoreo', 'Cerrado'], datos: true, pos: ['PO 1', 'PO 2'], sos: ['SO x'] };
  function borr(campo, valores) {
    var b = new S(ini, OP);
    b.campo = campo;
    Object.keys(valores || {}).forEach(function (k) { b[k] = valores[k]; });
    return b;
  }
  var l = new L(ini, OP);
  Check('SL1 nace vacia: no se puede enviar y lo dice', [true, true],
    [l.validarEnvio().some(function (e) { return /Agrega al menos un cambio/.test(e.mensaje); }), l.pares() === null]);
  var r1 = l.agregar(borr('estado', { propuesto: 'En Monitoreo' }));
  var r2 = l.agregar(borr('f_cierre', { propuesto: '2026-11-15' }));
  Check('SL2 agregar no borra lo anterior; el Motivo general no se pide al agregar', [true, true, 2, ['estado', 'f_cierre']],
    [r1.ok, r2.ok, l.items.length, l.items.map(function (x) { return x.campo; })]);
  var r3 = l.agregar(borr('estado', { propuesto: 'Cerrado' }));
  Check('SL3 dos cambios de Estado: no; dice cual y cual editar', [false, 'duplicado', 0, 2, true],
    [r3.ok, r3.errores[0].campo, r3.indice, l.items.length, /Ya está en la lista: Estado/.test(r3.errores[0].mensaje)]);
  var r4 = l.agregar(borr('f_cierre', { propuesto: '2026-12-01' }));
  Check('SL3 la misma fecha compromiso dos veces: no', [false, 1], [r4.ok, r4.indice]);
  var r5 = l.agregar(borr('f_analisis', { propuesto: '2027-01-10' }));
  Check('SL4 fechas DISTINTAS en la misma solicitud: si', [true, 3], [r5.ok, l.items.length]);
  var r6 = l.agregar(borr('f_solucion', { propuesto: '2026-09-01' }));
  Check('SL4 cada cambio pasa por la validacion de su tipo (misma fecha = no)', [false, 'propuesto'], [r6.ok, r6.errores[0].campo]);

  var e = l.editar(0);
  Check('SL5 Editar carga el cambio en un borrador', ['estado', 'En Monitoreo', 0], [e.campo, e.propuesto, l.editando]);
  e.propuesto = 'Cerrado';
  var r7 = l.agregar(e);
  Check('SL5 ... y lo actualiza en su lugar, sin duplicar', [true, 3, 'Cerrado', -1],
    [r7.ok, l.items.length, l.items[0].propuesto, l.editando]);
  var e2 = l.editar(1);
  e2.campo = 'f_analisis';
  Check('SL5 editar no puede chocar con otro de la lista', [false, 2], [l.agregar(e2).ok, l.agregar(e2).indice]);
  l.editando = -1;
  Check('SL6 Quitar', [true, ['estado', 'f_cierre']], [l.quitar(2), l.items.map(function (x) { return x.campo; })]);

  l.motivo = 'Se reprograma';
  Check('SL7 Estado + UNA fecha: UNA solicitud con el contrato de hoy (tipo estado + campo_fecha)',
    [[], true, [['tipo', 'estado'], ['estado_nuevo', 'Cerrado'], ['campo_fecha', 'f_cierre'], ['fecha_nueva', '2026-11-15'], ['motivo', 'Se reprograma']], l.llave],
    [l.validarEnvio(), l.contrato().soportado, l.pares().filter(function (x) { return x[0] !== 'llave' && x[0] !== 'folio'; }),
     l.pares().filter(function (x) { return x[0] === 'llave'; })[0][1]]);
  Check('SL7 sin subestado_nuevo', false, l.pares().some(function (x) { return x[0] === 'subestado_nuevo'; }));
  l.agregar(borr('f_analisis', { propuesto: '2027-01-10' }));
  Check('SL8 Estado + dos fechas: el servidor no lo guarda junto -> no se envia (sin pares), y lo explica', [false, null, true],
    [l.contrato().soportado, l.pares(), /No se envía nada por partes/.test(l.contrato().mensaje)]);

  // Titulo / PO / SO: cada dato una vez; varios juntos = UNA solicitud datos.
  var ld = new L(ini, OP);
  var bt = borr('datos'); bt.datos.titulo = 'Nuevo título';
  var bp = borr('datos'); bp.datos.po = 'PO 2';
  var bp2 = borr('datos'); bp2.datos.po = 'PO 1';
  ld.motivo = 'Cambio de responsable';
  Check('SL9 Título y PO en dos renglones; el mismo dato dos veces no', [true, true, false],
    [ld.agregar(bt).ok, ld.agregar(bp).ok, ld.agregar(bp2).ok]);
  Check('SL9 viajan como UNA solicitud datos', [['tipo', 'datos'], ['titulo_nuevo', 'Nuevo título'], ['po_nuevo', 'PO 2'], ['motivo', 'Cambio de responsable']],
    ld.pares().filter(function (x) { return x[0] !== 'llave' && x[0] !== 'folio'; }));

  // Otros: su explicacion es suya; el Motivo general se agrega.
  var lo = new L(ini, OP);
  var bo = borr('otros');
  Check('SL10 Otros sin explicacion: no se agrega', [false, 'Explica qué hay que corregir.'], [lo.agregar(bo).ok, lo.agregar(bo).errores[0].mensaje]);
  bo.motivo = 'Era /A/Cat 2';
  lo.agregar(bo);
  lo.motivo = 'Revisión de alcance';
  Check('SL10 Otros: explicacion + Motivo, sin valores (no cambia nada por si sola)',
    [[['tipo', 'otros'], ['motivo', 'Era /A/Cat 2\n\nMotivo: Revisión de alcance']], 'Otros (explicación)'],
    [lo.pares().filter(function (x) { return x[0] !== 'llave' && x[0] !== 'folio'; }), lo.texto(lo.items[0]).tipo]);
  lo.agregar(borr('estado', { propuesto: 'Cerrado' }));
  Check('SL10 Otros + Estado: no cabe en una solicitud de hoy', false, lo.contrato().soportado);

  // SLV) Con sql/34 (opciones.varios): cualquier combinacion viaja como UNA
  // solicitud tipo varios; cada fecha con la clave de su etapa; sin
  // Subestado; "Otros" sigue yendo solo.
  var OPV = Object.assign({}, OP, { varios: true, rutas: ['/A/Cat 2'] });
  var lv = new L(ini, OPV);
  var bvE = new S(ini, OPV); bvE.campo = 'estado'; bvE.propuesto = 'En Monitoreo'; bvE.subestado = 'Solucionado';
  var bvA = new S(ini, OPV); bvA.campo = 'f_analisis'; bvA.propuesto = '2027-01-10';
  var bvC = new S(ini, OPV); bvC.campo = 'f_cierre'; bvC.propuesto = '2026-11-15';
  var bvP = new S(ini, OPV); bvP.campo = 'pct'; bvP.fijarPct('/A/Cat 3', '30');
  var bvT = new S(ini, OPV); bvT.campo = 'datos'; bvT.datos.titulo = 'Título nuevo';
  [bvE, bvA, bvC, bvP, bvT].forEach(function (b) { lv.agregar(b); });
  lv.motivo = 'Replaneación';
  Check('SLV1 cinco cambios (Estado, dos fechas, %, Título): UNA solicitud varios, sin campo_fecha ni Subestado',
    [true, 'varios', [['tipo', 'varios'], ['estado_nuevo', 'En Monitoreo'], ['f_analisis_nueva', '2027-01-10'], ['f_cierre_nueva', '2026-11-15'],
      ['pct_categoria', '/A/Cat 3'], ['pct_valor', '30'], ['titulo_nuevo', 'Título nuevo'], ['motivo', 'Replaneación']], lv.llave],
    [lv.contrato().soportado, lv.contrato().forma, lv.pares().filter(function (x) { return x[0] !== 'llave' && x[0] !== 'folio'; }),
     lv.pares().filter(function (x) { return x[0] === 'llave'; })[0][1]]);
  var lvo = new L(ini, OPV);
  var bvO = new S(ini, OPV); bvO.campo = 'otros'; bvO.motivo = 'Explicación';
  lvo.agregar(bvE); lvo.agregar(bvO);
  Check('SLV2 con varios, Otros + Estado sigue sin enviarse (Otros va solo)', [false, null, true],
    [lvo.contrato().soportado, lvo.pares(), /«Otros» es una explicación y va en su propia solicitud/.test(lvo.contrato().mensaje)]);
  var lv1 = new L(ini, OPV); lv1.agregar(bvC); lv1.motivo = 'm';
  Check('SLV3 con varios, un solo cambio sigue con su contrato de siempre (tipo fecha)', ['uno', 'fecha'],
    [lv1.contrato().forma, lv1.pares().filter(function (x) { return x[0] === 'tipo'; })[0][1]]);

  // Interfaz.
  var datos = JSON.parse(JSON.stringify(DATOS));
  datos.estados_problem = ['En Análisis', 'En Solución', 'En Monitoreo', 'Cerrado'];
  datos.subestados_problem = ['Solucionado'];
  datos.persistencia_solicitudes = true;
  var p = Pagina(ok(datos), function () { return nunca(); }, 'MOD');
  function accion(a) {
    var el = Elemento('b'); el.setAttribute('data-accion', a);
    p.sel('regDetCuerpo').disparar('click', { target: el });
  }
  function item(v) {
    var el = Elemento('b'); el.setAttribute('data-cambio-item', v);
    p.sel('regDetCuerpo').disparar('click', { target: el });
  }
  function elegir(id, v) { p.sel(id).value = v; p.sel('regDetCuerpo').disparar('change', { target: p.sel(id) }); }
  function escribir(id, v) { p.sel(id).value = v; p.sel('regDetCuerpo').disparar('input', { target: p.sel(id) }); }
  var envios = [];
  return esperar().then(function () {
    p.registro.pedirSolicitud = function (url, op) {
      var campos = {};
      op.body.forEach(function (v, k) { campos[k] = v; });
      envios.push(campos);
      return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ enviada: true, id_solicitud: 41, repetida: false }); } });
    };
    clicFolio(p, 'PRB 2026-000001');
    accion('solicitar-cambios');
    var form = p.sel('regCambio').innerHTML;
    Check('SL11 formulario: agregar, la lista "Cambios que deseas solicitar", Motivo y Enviar; sin Subestado (MOD)', [true, true, true, true, false],
      [/data-accion="cambio-agregar">Agregar cambio a la solicitud</.test(form), /Cambios que deseas solicitar/.test(form),
       /id="regCambioMotivo"/.test(form), /data-accion="cambio-preparar">Enviar solicitud</.test(form), /Subestado/.test(form)]);
    escribir('regCambioMotivo', 'Reprogramación acordada');
    elegir('regCambioCampo', 'estado');
    p.sel('regCambioEstado').value = 'En Monitoreo';
    accion('cambio-agregar');
    var msg = p.sel('regCambioMsg').innerHTML;
    Check('SL12 agregado: en la lista con actual y solicitado; formulario limpio; ofrece el atajo de fecha', [1, true, '', '', true],
      [p.registro.lista.items.length, /<td>Estado<\/td><td>En Solución<\/td><td>En Monitoreo<\/td>/.test(p.sel('regCambioLista').innerHTML),
       p.sel('regCambioCampo').value, p.sel('regCambioEstado').value, /¿También deseas cambiar una fecha de compromiso\?/.test(msg)]);
    accion('cambio-atajo-fecha');
    Check('SL13 atajo: el Estado sigue en la lista; el formulario pasa a Fecha de compromiso (etapa del Estado actual)',
      [1, 'fecha', 'f_solucion', false, false], [p.registro.lista.items.length, p.sel('regCambioCampo').value, p.sel('regCambioFechaCampo').value,
        p.sel('regCambioGrupoEtapa').hidden, p.sel('regCambioGrupoFecha').hidden]);
    elegir('regCambioFechaCampo', 'f_cierre');
    p.sel('regCambioNueva').value = '2026-11-15';
    accion('cambio-agregar');
    Check('SL13 ... y al agregarla quedan los dos en la misma lista', [['estado', 'f_cierre'], true],
      [p.registro.lista.items.map(function (x) { return x.campo; }), /Fecha compromiso de Cierre<\/td><td>—<\/td><td>15\/11\/2026/.test(p.sel('regCambioLista').innerHTML)]);
    elegir('regCambioCampo', 'fecha');
    elegir('regCambioFechaCampo', 'f_cierre');
    p.sel('regCambioNueva').value = '2026-12-20';
    accion('cambio-agregar');
    Check('SL14 la misma fecha otra vez: mensaje claro y boton para editar la que ya esta', [2, 'ini-cambio-msg error', true, true],
      [p.registro.lista.items.length, p.sel('regCambioMsg').className, /Ya está en la lista: Fecha compromiso de Cierre/.test(p.sel('regCambioMsg').innerHTML),
       /data-cambio-item="editar\|1">Editar el que ya está/.test(p.sel('regCambioMsg').innerHTML)]);
    item('editar|1');
    Check('SL15 Editar: el cambio vuelve al formulario y el boton dice Actualizar', ['fecha', 'f_cierre', '2026-11-15', 'Actualizar cambio', false],
      [p.sel('regCambioCampo').value, p.sel('regCambioFechaCampo').value, p.sel('regCambioNueva').value, p.sel('regCambioAgregar').textContent,
       p.sel('regCambioEdCancelar').hidden]);
    p.sel('regCambioNueva').value = '2026-12-20';
    accion('cambio-agregar');
    Check('SL15 ... y se actualiza sin duplicar; el Motivo sigue', [2, '2026-12-20', 'Reprogramación acordada', 'Reprogramación acordada', 'Agregar cambio a la solicitud'],
      [p.registro.lista.items.length, p.registro.lista.items[1].propuesto, p.sel('regCambioMotivo').value, p.registro.lista.motivo,
       p.sel('regCambioAgregar').textContent]);
    elegir('regCambioCampo', 'fecha');
    elegir('regCambioFechaCampo', 'f_analisis');
    p.sel('regCambioNueva').value = '2027-01-10';
    accion('cambio-agregar');
    Check('SL16 tres cambios (Estado + dos fechas): la lista avisa que hoy no cabe en una solicitud', [3, true],
      [p.registro.lista.items.length, /todavía no admite estos 3 cambios/.test(p.sel('regCambioLista').innerHTML)]);
    accion('cambio-preparar');
    accion('cambio-confirmar');
    return esperar().then(function () {
      Check('SL16 ... y "Enviar" no manda nada (ni por partes)', [0, 'ini-cambio-msg aviso', true],
        [envios.length, p.sel('regCambioMsg').className, /No se envió/.test(p.sel('regCambioMsg').innerHTML)]);
      item('quitar|2');
      Check('SL17 Quitar la deja en Estado + una fecha; el Motivo sigue', [['estado', 'f_cierre'], 'Reprogramación acordada'],
        [p.registro.lista.items.map(function (x) { return x.campo; }), p.registro.lista.motivo]);
      accion('cambio-preparar');
      Check('SL18 revision antes de enviar: la lista completa y el Motivo', [0, true, true, true],
        [envios.length, /Estado: En Solución → En Monitoreo/.test(p.sel('regCambioMsg').innerHTML),
         /Fecha compromiso de Cierre: — → 20\/12\/2026/.test(p.sel('regCambioMsg').innerHTML), /Motivo: Reprogramación acordada/.test(p.sel('regCambioMsg').innerHTML)]);
      accion('cambio-confirmar');
      accion('cambio-confirmar');
      return esperar().then(esperar);
    }).then(function () {
      Check('SL19 UNA peticion con los dos cambios, sin Subestado; enviada con el numero de la base',
        [1, 'estado', 'En Monitoreo', 'f_cierre', '2026-12-20', 'Reprogramación acordada', false, true],
        [envios.length, envios[0].tipo, envios[0].estado_nuevo, envios[0].campo_fecha, envios[0].fecha_nueva, envios[0].motivo,
         'subestado_nuevo' in envios[0], /Solicitud #41 enviada/.test(p.sel('regCambioMsg').innerHTML)]);
      Check('SL19 enviada: la lista ya no se edita; el registro no cambia', [false, 2, true, 'En Solución'],
        [p.registro.accionItemCambio('quitar|0'), p.registro.lista.items.length, /data-cambio-item="quitar\|0" disabled/.test(p.sel('regCambioLista').innerHTML),
         p.registro.registro.buscar('PRB 2026-000001').estado]);
      accion('cambio-cancelar');
      accion('solicitar-cambios');
      Check('SL20 Cancelar descarta: al reabrir la lista esta vacia y la llave es otra', [0, true],
        [p.registro.lista.items.length, p.registro.lista.llave !== envios[0].llave]);
    });
  });
});

// ---------------------------------------------------------------------------
// SLW) Con solicitudes_varios (sql/34) la pagina manda Estado + dos fechas
// como UNA peticion tipo varios; sin el, la misma lista no se envia.
// ---------------------------------------------------------------------------
[true, false].forEach(function (conVarios) {
  pruebas.push(function () {
    var datos = JSON.parse(JSON.stringify(DATOS));
    datos.estados_problem = ['En Análisis', 'En Solución', 'En Monitoreo', 'Cerrado'];
    datos.persistencia_solicitudes = true;
    datos.solicitudes_varios = conVarios;
    var p = Pagina(ok(datos), function () { return nunca(); }, 'MOD');
    function accion(a) {
      var el = Elemento('b'); el.setAttribute('data-accion', a);
      p.sel('regDetCuerpo').disparar('click', { target: el });
    }
    function elegir(id, v) { p.sel(id).value = v; p.sel('regDetCuerpo').disparar('change', { target: p.sel(id) }); }
    var envios = [], nombre = conVarios ? 'con varios' : 'sin varios';
    return esperar().then(function () {
      p.registro.pedirSolicitud = function (url, op) {
        var campos = {};
        op.body.forEach(function (v, k) { campos[k] = v; });
        envios.push(campos);
        return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ enviada: true, id_solicitud: 77, repetida: false }); } });
      };
      clicFolio(p, 'PRB 2026-000001');
      accion('solicitar-cambios');
      p.sel('regCambioMotivo').value = 'Replaneación';
      elegir('regCambioCampo', 'estado');
      p.sel('regCambioEstado').value = 'En Monitoreo';
      accion('cambio-agregar');
      [['f_cierre', '2026-11-15'], ['f_analisis', '2027-01-10']].forEach(function (f) {
        elegir('regCambioCampo', 'fecha');
        elegir('regCambioFechaCampo', f[0]);
        p.sel('regCambioNueva').value = f[1];
        accion('cambio-agregar');
      });
      Check('SLW1 ' + nombre + ': la lista ' + (conVarios ? 'no avisa nada' : 'avisa que hoy no cabe'), !conVarios,
        /todavía no admite estos 3 cambios/.test(p.sel('regCambioLista').innerHTML));
      accion('cambio-preparar');
      accion('cambio-confirmar');
      return esperar().then(esperar);
    }).then(function () {
      if (conVarios) {
        Check('SLW2 con varios: UNA peticion tipo varios con el Estado y las dos fechas por etapa; enviada', [1, 'varios', 'En Monitoreo', '2026-11-15', '2027-01-10', false, false, true],
          [envios.length, envios[0].tipo, envios[0].estado_nuevo, envios[0].f_cierre_nueva, envios[0].f_analisis_nueva,
           'campo_fecha' in envios[0], 'subestado_nuevo' in envios[0], /Solicitud #77 enviada/.test(p.sel('regCambioMsg').innerHTML)]);
      } else {
        Check('SLW2 sin varios: nada se envia (ni por partes)', [0, true], [envios.length, /No se envió/.test(p.sel('regCambioMsg').innerHTML)]);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// SD) Solicitar cambios de Título / PO / SO capturados (sql/25,
// solicitudes_datos): solo si el servidor lo dice; PO / SO son los de la
// iniciativa (po_capturado / so_capturado), de la lista del catálogo; el
// Código nunca se pide.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var S = R.SolicitudCambio;
  Check('SD1 campos(true): Título / PO / SO antes de Otros; campos() sigue sin ellos',
    [['fecha', 'estado', 'pct', 'datos', 'otros'], ['fecha', 'estado', 'pct', 'otros']],
    [S.campos(true).map(function (c) { return c.clave; }), S.campos().map(function (c) { return c.clave; })]);
  var ini = Ini('PRB 2026-000001', { titulo: 'Uno', titulo_problem: 'Uno', po: 'PO de la categoria', so: 'SO de la categoria',
                                     po_capturado: 'PO 1', so_capturado: null });
  var LISTAS = { datos: true, pos: ['PO 1', 'PO 2'], sos: ['SO x'] };
  var c = new S(ini, LISTAS);
  c.campo = 'datos'; c.motivo = 'Cambio de responsable';
  Check('SD2 datos sin marcar ninguno: error', ['datos'], c.validar().map(function (e) { return e.campo; }));
  Check('SD3 lo de ahora: Título del Problem y PO / SO CAPTURADOS (no los de la categoría)', ['Uno', 'PO 1', ''],
    [c.datoActual('titulo'), c.datoActual('po'), c.datoActual('so')]);
  c.datos.po = 'PO inventado';
  Check('SD4 PO fuera del catálogo: error', ['po'], c.validar().map(function (e) { return e.dato; }));
  c.datos.po = 'PO 1';
  Check('SD5 mismo PO: sin cambio', ['po'], c.validar().map(function (e) { return e.dato; }));
  c.datos.po = 'PO 2'; c.datos.titulo = '  Uno nuevo '; c.datos.so = '';
  Check('SD6 SO marcado y vacío: error (nunca se pide dejarlo vacío)', [['so'], true],
    [c.validar().map(function (e) { return e.dato; }), /no puede quedar vacío/.test(c.validar()[0].mensaje)]);
  c.datos.so = 'SO x';
  Check('SD7 válida y el resumen dice anterior → nuevo de cada dato', [[], [['titulo', 'Uno', 'Uno nuevo'], ['po', 'PO 1', 'PO 2'], ['so', '', 'SO x']], true],
    [c.validar(), c.resumen().datos.map(function (d) { return [d.campo, d.anterior, d.nuevo]; }), c.resumen().automatica]);
  Check('SD8 pares de envío: tipo datos y solo las claves pedidas; sin código ni po de la categoría',
    [['folio', 'PRB 2026-000001'], ['tipo', 'datos'], ['titulo_nuevo', 'Uno nuevo'], ['po_nuevo', 'PO 2'], ['so_nuevo', 'SO x'], ['motivo', 'Cambio de responsable']],
    c.pares().filter(function (x) { return x[0] !== 'llave'; }));
  c.datos.titulo = null; c.datos.so = null;
  Check('SD9 sin marcar = no viaja', ['po_nuevo'], c.pares().map(function (x) { return x[0]; }).filter(function (k) { return /_nuevo$/.test(k); }));
  var rev = new R.RevisionSolicitud(c.resumen(), 'SORIANA\\t_mod');
  Check('SD10 aprobar: los pares de Modificar (po), con el folio leído', [['accion', 'modificar'], ['folio', 'PRB 2026-000001'], ['po', 'PO 2']],
    rev.aprobar('SORIANA\\t_adm').pares);
  var apagado = new S(ini, { pos: ['PO 2'] });
  apagado.campo = 'datos'; apagado.datos.po = 'PO 2'; apagado.motivo = 'm';
  Check('SD11 sin solicitudes_datos (sql/25 sin aplicar): datos se rechaza y remite a Otros', [['campo'], true],
    [apagado.validar().map(function (e) { return e.campo; }), /Otros/.test(apagado.validar()[0].mensaje)]);

  // UI: opción, grupo, casillas y envío.
  var d = JSON.parse(JSON.stringify(DATOS));
  d.persistencia_solicitudes = true; d.solicitudes_datos = true;
  d.iniciativas.forEach(function (i) { if (i.folio === 'PRB 2026-000001') { i.po_capturado = 'PO 1'; i.so_capturado = null; } });
  var p = Pagina(ok(d), function () { return nunca(); });
  function accion(a) {
    var el = Elemento('b'); el.setAttribute('data-accion', a);
    p.sel('regDetCuerpo').disparar('click', { target: el });
  }
  function elegirEn(id, v) { p.sel(id).value = v; p.sel('regDetCuerpo').disparar('change', { target: p.sel(id) }); }
  var envios = [];
  return esperar().then(function () {
    p.registro.fijarDuenosCatalogo({ po: ['PO 1', 'PO 2'], so: ['SO x'] });
    p.registro.pedirSolicitud = function (url, op) {
      var campos = {};
      op.body.forEach(function (v, k) { campos[k] = v; });
      envios.push(campos);
      return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ enviada: true, id_solicitud: 30, repetida: false }); } });
    };
    clicFolio(p, 'PRB 2026-000001');
    accion('solicitar-cambios');
    var html = p.sel('regCambio').innerHTML;
    var grupo = html.slice(html.indexOf('id="regCambioGrupoDatos"'));
    Check('SD12 con solicitudes_datos: la opción va antes de Otros; el grupo con el PO capturado y sin Código',
      [true, true, true, false, false],
      [/<option value="datos">Título, Product Owner o Service Owner<\/option><option value="otros">/.test(html),
       /id="regCambioGrupoDatos" hidden/.test(html),
       /<span class="ini-cambio-dato-nombre" id="regCambioDato-po-nombre">Product Owner<\/span><label class="ini-cambio-marca"><input type="checkbox" id="regCambioDato-po"[^>]*> <span>Incluir cambios al Product Owner<\/span><\/label><\/div><span class="ini-cambio-rot">Valor actual<\/span><span class="ini-cambio-actual">PO 1</.test(grupo),
       /regCambioDato-codigo|Código/.test(grupo), /PO de la categoria/.test(grupo)]);
    elegirEn('regCambioCampo', 'datos');
    Check('SD13 elegir datos: solo su grupo', [false, true, true],
      [p.sel('regCambioGrupoDatos').hidden, p.sel('regCambioGrupoFecha').hidden, p.sel('regCambioGrupoPct').hidden]);
    p.sel('regCambioDato-po').checked = true; p.sel('regCambioDatoValor-po').value = 'PO 2';
    p.sel('regCambioDato-titulo').checked = false; p.sel('regCambioDatoValor-titulo').value = 'no se marca';
    p.sel('regCambioMotivo').value = 'Nuevo responsable';
    accion('cambio-agregar');
    accion('cambio-preparar');
    accion('cambio-confirmar');
    return esperar().then(esperar);
  }).then(function () {
    Check('SD14 envío: tipo datos, solo po_nuevo (lo no marcado no viaja), sin codigo; enviada con el número de la base',
      ['datos', 'PO 2', false, false, false, true],
      [envios[0] && envios[0].tipo, envios[0] && envios[0].po_nuevo, !!envios[0] && 'titulo_nuevo' in envios[0], !!envios[0] && 'so_nuevo' in envios[0],
       !!envios[0] && 'codigo' in envios[0], /Solicitud #30 enviada/.test(p.sel('regCambioMsg').innerHTML)]);
    Check('SD15 el registro no cambia al enviar', 'PO 1', p.registro.registro.buscar('PRB 2026-000001').po_capturado);
    var sin = Pagina(ok(DATOS), function () { return nunca(); });
    return esperar().then(function () {
      clicFolio(sin, 'PRB 2026-000001');
      var el = Elemento('b'); el.setAttribute('data-accion', 'solicitar-cambios');
      sin.sel('regDetCuerpo').disparar('click', { target: el });
      Check('SD16 sin solicitudes_datos: ni la opción ni el grupo', [false, false],
        [/value="datos"/.test(sin.sel('regCambio').innerHTML), /regCambioGrupoDatos/.test(sin.sel('regCambio').innerHTML)]);
    });
  });
});

// ---------------------------------------------------------------------------
// SX) Solicitar cambios de Título / PO / SO por el formulario: cada casilla
// decide SU dato; lo no marcado no viaja (ni vacío); lo marcado nunca es
// vacío (ni espacios, ni el «— Elige —»). Lo que no pasa no se envía.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var d = JSON.parse(JSON.stringify(DATOS));
  d.persistencia_solicitudes = true; d.solicitudes_datos = true;
  var p = Pagina(ok(d), function () { return nunca(); });
  var envios = [];
  function accion(a) {
    var el = Elemento('b'); el.setAttribute('data-accion', a);
    p.sel('regDetCuerpo').disparar('click', { target: el });
  }
  // marcas: { titulo / po / so: valor } (presente = casilla marcada).
  function caso(marcas) {
    if (p.sel('regCambio').innerHTML) accion('cambio-cancelar');
    accion('solicitar-cambios');
    p.sel('regCambioCampo').value = 'datos';
    p.sel('regDetCuerpo').disparar('change', { target: p.sel('regCambioCampo') });
    ['titulo', 'po', 'so'].forEach(function (k) {
      var marcado = Object.prototype.hasOwnProperty.call(marcas, k);
      p.sel('regCambioDato-' + k).checked = marcado;
      // Sin marcar se deja algo escrito / elegido: igual no debe viajar.
      p.sel('regCambioDatoValor-' + k).value = marcado ? marcas[k] : (k === 'titulo' ? 'escrito sin marcar' : k === 'po' ? 'PO 2' : 'SO y');
    });
    p.sel('regCambioMotivo').value = 'Motivo';
    var antes = envios.length;
    accion('cambio-preparar');
    return esperar().then(esperar).then(function () {
      return { envio: envios.length > antes ? envios[envios.length - 1] : null, msg: p.sel('regCambioMsg').innerHTML,
               invalidos: ['titulo', 'po', 'so'].filter(function (k) { return p.sel('regCambioDatoValor-' + k).getAttribute('aria-invalid') === 'true'; }) };
    });
  }
  function claves(e) { return e ? Object.keys(e).filter(function (k) { return /_nuevo$/.test(k); }).sort() : null; }
  var ini = function () { return p.registro.registro.buscar('PRB 2026-000001'); };
  var r = {};
  return esperar().then(function () {
    p.registro.fijarDuenosCatalogo({ po: ['PO 1', 'PO 2'], so: ['SO x', 'SO y'] });
    p.registro.pedirSolicitud = function (url, op) {
      var campos = {};
      op.body.forEach(function (v, k) { campos[k] = v; });
      envios.push(campos);
      return Promise.resolve({ status: 200, json: function () { return Promise.resolve({ enviada: true, id_solicitud: 40 + envios.length, repetida: false }); } });
    };
    clicFolio(p, 'PRB 2026-000001');
    return caso({ titulo: '  Título nuevo  ' });
  }).then(function (x) {
    r.A = x;
    return caso({ po: 'PO 2' });
  }).then(function (x) {
    r.B = x;
    return caso({ so: 'SO y' });
  }).then(function (x) {
    r.C = x;
    return caso({ titulo: 'Los tres', po: 'PO 2', so: 'SO y' });
  }).then(function (x) {
    r.D = x;
    return caso({ titulo: '' });
  }).then(function (x) {
    r.E = x;
    return caso({ titulo: '     ' });
  }).then(function (x) {
    r.F = x;
    return caso({ po: '' });
  }).then(function (x) {
    r.G = x;
    return caso({ so: '' });
  }).then(function (x) {
    r.H = x;
    return caso({ so: 'SO inventado' });
  }).then(function (x) {
    r.H2 = x;
    return caso({ titulo: 'Válido', po: '' });
  }).then(function (x) {
    r.H3 = x;
    return caso({});
  }).then(function (x) {
    r.I = x;
    Check('SX-A solo Título: viaja solo titulo_nuevo, recortado; PO / SO ni siquiera vacíos', [['titulo_nuevo'], 'Título nuevo', 'datos'],
      [claves(r.A.envio), r.A.envio && r.A.envio.titulo_nuevo, r.A.envio && r.A.envio.tipo]);
    Check('SX-B solo PO: viaja solo po_nuevo con la persona elegida', [['po_nuevo'], 'PO 2'], [claves(r.B.envio), r.B.envio && r.B.envio.po_nuevo]);
    Check('SX-C solo SO: viaja solo so_nuevo con la persona elegida', [['so_nuevo'], 'SO y'], [claves(r.C.envio), r.C.envio && r.C.envio.so_nuevo]);
    Check('SX-D los tres: viajan los tres', [['po_nuevo', 'so_nuevo', 'titulo_nuevo'], 'Los tres', 'PO 2', 'SO y'],
      [claves(r.D.envio), r.D.envio && r.D.envio.titulo_nuevo, r.D.envio && r.D.envio.po_nuevo, r.D.envio && r.D.envio.so_nuevo]);
    Check('SX-ABCD enviar no cambia la iniciativa (la aplica ADM)', ['T PRB 2026-000001', 'PO 1', 'SO x'],
      [ini().titulo_problem, ini().po_capturado, ini().so_capturado]);
    Check('SX-E Título marcado y vacío: no se envía; error en el título', [null, ['titulo'], true],
      [r.E.envio, r.E.invalidos, /Título: escribe el nuevo título; no puede quedar vacío/.test(r.E.msg)]);
    Check('SX-F Título de solo espacios: no se envía', [null, ['titulo']], [r.F.envio, r.F.invalidos]);
    Check('SX-G PO marcado con «— Elige —» (valor vacío): no se envía', [null, ['po'], true],
      [r.G.envio, r.G.invalidos, /Product Owner capturado: elige una persona de la lista; no puede quedar vacío/.test(r.G.msg)]);
    Check('SX-H SO marcado sin persona: no se envía', [null, ['so']], [r.H.envio, r.H.invalidos]);
    Check('SX-H2 SO que no es de la lista: no se envía', [null, ['so']], [r.H2.envio, r.H2.invalidos]);
    Check('SX-H3 un dato válido no salva a otro marcado y vacío: nada se envía', [null, ['po']], [r.H3.envio, r.H3.invalidos]);
    Check('SX-I nada marcado: no se envía una solicitud vacía', [null, true],
      [r.I.envio, /Marca qué dato quieres cambiar/.test(r.I.msg)]);
    Check('SX envíos: exactamente los cuatro válidos', 4, envios.length);
  });
});

// ---------------------------------------------------------------------------
// S) Solicitar cambios e Historial de cambios (sin persistencia)
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var reg = Adm(R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS))));
  var S = R.SolicitudCambio;
  Check('S1 campos designados: Fecha de compromiso (una sola opcion), Estado, % y Otros', [['fecha', 'estado', 'pct', 'otros'],
    ['Fecha de compromiso', 'Estado', 'Categorías: % de disminución o agregar', 'Otros (explica la corrección)']],
    [S.campos().map(function (c) { return c.clave; }), S.campos().map(function (c) { return c.rotulo; })]);
  Check('S1 las tres etapas de Fecha de compromiso', [['f_analisis', 'f_solucion', 'f_cierre'],
    ['Fecha compromiso de Análisis', 'Fecha compromiso de Solución', 'Fecha compromiso de Cierre']],
    [S.camposFecha().map(function (c) { return c.clave; }), S.camposFecha().map(function (c) { return c.rotulo; })]);
  // SF) Etapa por omision de "Fecha de compromiso": la del Estado actual
  // (En Monitoreo -> Cierre, la regla de FECHA_DEL_ESTADO); Cerrado ->
  // Cierre; otro Estado, ninguna (quien pide la elige).
  Check('SF1 etapa por omision segun el Estado', ['f_analisis', 'f_solucion', 'f_cierre', 'f_cierre', '', '', ''],
    ['En Análisis', 'En Solución', 'En Monitoreo', 'Cerrado', 'Pendiente', 'Cancelado', null].map(function (e) {
      return S.etapaPorOmision(Ini('X', { estado: e }));
    }));
  var sf = new S(Ini('X', { estado: 'Cerrado', f_analisis: '2026-01-01', f_solucion: '2026-02-01', f_cierre: '2026-03-01' }));
  Check('SF2 cerrada: abre sin "Qué cambiar"; al elegir Fecha de compromiso arranca en Cierre', ['', 'f_cierre', 'fecha', '2026-03-01'],
    [new S(Ini('X', { estado: 'Cerrado' })).campo, sf.elegir('fecha'), sf.queCambiar(), sf.actual()]);
  Check('SF3 se puede elegir cualquiera de las tres; la fecha actual es la de la etapa elegida',
    [['f_analisis', '2026-01-01'], ['f_solucion', '2026-02-01'], ['f_cierre', '2026-03-01']],
    ['f_analisis', 'f_solucion', 'f_cierre'].map(function (k) { sf.elegirEtapa(k); return [sf.campo, sf.actual()]; }));
  sf.elegirEtapa('f_solucion');
  Check('SF3 volver a elegir Fecha de compromiso conserva la etapa elegida', 'f_solucion', sf.elegir('fecha'));
  sf.elegir('estado'); sf.elegir('fecha');
  Check('SF3 tras otra opcion, vuelve a la del Estado actual', 'f_cierre', sf.campo);
  var sn = new S(Ini('X', { estado: 'Pendiente' }));
  sn.elegir('fecha'); sn.propuesto = '2027-01-01'; sn.motivo = 'm';
  Check('SF4 Estado sin etapa por omision: nada elegido y se exige elegirla', ['fecha', 'fecha', null, ['etapa'], true],
    [sn.campo, sn.queCambiar(), sn.actual(), sn.validar().map(function (e) { return e.campo; }), /Análisis, Solución o Cierre/.test(sn.validar()[0].mensaje)]);
  sn.elegirEtapa('x_inventada');
  Check('SF4 etapa inventada = sin etapa', 'fecha', sn.campo);
  sn.elegirEtapa('f_solucion');
  Check('SF5 con etapa: valida y viaja con el contrato de siempre (tipo fecha + campo_fecha)',
    [[], [['tipo', 'fecha'], ['campo_fecha', 'f_solucion'], ['fecha_nueva', '2027-01-01'], ['motivo', 'm']], 'Fecha compromiso de Solución', 'Solución'],
    [sn.validar(), sn.pares().filter(function (x) { return x[0] !== 'llave' && x[0] !== 'folio'; }), sn.resumen().rotulo, sn.resumen().etapa]);
  Check('SF5 aprobar: el par de Modificar de esa etapa', [['accion', 'modificar'], ['folio', 'X'], ['f_solucion', '2027-01-01']],
    new R.RevisionSolicitud(sn.resumen(), 'u').aprobar('a').pares);
  Check('SF5 un resumen sin etapa no produce pares', null,
    new R.RevisionSolicitud({ folio: 'X', campo: 'fecha', nuevo: '2027-01-01', automatica: true }, 'u').pares());
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
  Check('S4 resumen (con la etapa de la fecha)', { folio: 'PRB 2026-000001', campo: 'f_solucion', rotulo: 'Fecha compromiso de Solución',
    anterior: '2026-09-01', nuevo: '2026-10-15', motivo: 'Proveedor', etapa: 'Solución', automatica: true }, c.resumen());

  // SR) Estado, % de categoria y Otros; revision (aprobar / rechazar) en memoria.
  var LISTAS = { estados: ['En Análisis', 'En Solución', 'Cerrado'], subestados: ['En Análisis', 'Solucionado'] };
  var e = new S(reg.buscar('PRB 2026-000001'), LISTAS);
  e.campo = 'estado'; e.motivo = 'Ya se resolvio';
  e.propuesto = 'Pausado';
  Check('SR1 Estado inventado se rechaza', ['propuesto'], e.validar().map(function (x) { return x.campo; }));
  e.propuesto = 'En Solución';
  Check('SR1 mismo Estado = sin cambio', ['propuesto'], e.validar().map(function (x) { return x.campo; }));
  e.propuesto = 'Cerrado'; e.subestado = 'Solucionado';
  Check('SR1 el borrador no usa el Subestado: ni lo valida, ni lo resume, ni lo envia', [[], undefined, false, 'En Solución'],
    [e.validar(), e.resumen().subestado, e.pares().some(function (x) { return x[0] === 'subestado_nuevo'; }), e.actual()]);
  Check('SR2 Estado valido', [[], 'Cerrado', true], [e.validar(), e.resumen().nuevo, e.resumen().automatica]);
  // Estado va solo (2026-10-26): una fecha que quedara en el borrador no
  // se valida, no se resume, no se envia ni se aplica.
  var ef = new S(reg.buscar('PRB 2026-000001'), LISTAS);
  ef.campo = 'estado'; ef.propuesto = 'Cerrado'; ef.motivo = 'Se cierra';
  ef.fechaCampo = 'f_solucion'; ef.fechaNueva = '2026-11-30';
  Check('SR2b Estado sin fecha: valida, sin fecha en el resumen, ni en el envio, ni al aprobar',
    [[], undefined, [['tipo', 'estado'], ['estado_nuevo', 'Cerrado'], ['motivo', 'Se cierra']],
     [['accion', 'modificar'], ['folio', 'PRB 2026-000001'], ['estado', 'Cerrado']]],
    [ef.validar(), ef.resumen().fecha, ef.pares().filter(function (x) { return x[0] !== 'llave' && x[0] !== 'folio'; }),
     new R.RevisionSolicitud(ef.resumen(), 'u').aprobar('a').pares]);
  ef.propuesto = 'En Solución';
  Check('SR2b mismo Estado: sigue pidiendo un Estado distinto', ['propuesto'], ef.validar().map(function (x) { return x.campo; }));
  Check('SR2 sin lista de estados: no se puede pedir', ['propuesto'],
    (function () { var x = new S(reg.buscar('PRB 2026-000001')); x.campo = 'estado'; x.propuesto = 'Cerrado'; x.motivo = 'm';
      return x.validar().map(function (y) { return y.campo; }); })());

  // Categorias: varias en UNA solicitud (% de ligadas y agregar del catalogo).
  var RUTAS_CAT = ['/A/Cat 1/Hoja', '/A/Cat 2', '/A/Cat 3', '/B/Cat 4'];
  // Agregar solo va por el par capturado de la iniciativa (2026-10-28):
  // estas rutas son de PO 1 / SO x, el par de PRB 2026-000001.
  var FILAS_CAT = RUTAS_CAT.map(function (r) { return { director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: r }; });
  // Sin iniciativa-admin.js (otra pagina o cache viejo): coincidencia exacta.
  var fb = new S(reg.buscar('PRB 2026-000001'), { rutas: RUTAS_CAT, filas: FILAS_CAT });
  Check('SR3 sin IniciativaAdmin: agrega solo la ruta exacta', [false, true], [fb.agregarCategoria('/a/cat 2').ok, fb.agregarCategoria('/A/Cat 2').ok]);
  // Desde aqui, con el Selector compartido (como en la pagina).
  (new Function('window', 'document', 'Catalogos', 'Escape', 'Duracion', leer('admin/iniciativa-admin.js')))(
    base.ventana, base.doc, base.ventana.Catalogos, base.ventana.Escape, base.ventana.Duracion);
  var k = new S(reg.buscar('PRB 2026-000001'), { estados: LISTAS.estados, subestados: LISTAS.subestados, rutas: RUTAS_CAT, filas: FILAS_CAT });
  k.campo = 'pct'; k.motivo = 'Se ajusta el alcance';
  Check('SR3 sin nada pedido se rechaza', ['categoria'], k.validar().map(function (x) { return x.campo; }));
  Check('SR3 % de una categoria no ligada no se acepta como %', [false, {}], [k.fijarPct('/Z/No ligada', '10'), k.pcts]);
  Check('SR3 valor actual de cada categoria', ['50', '25'], [k.pctActual('/A/Cat 1/Hoja'), k.pctActual('/A/Cat 3')]);
  k.fijarPct('/A/Cat 3', '25');
  Check('SR3 mismo % = sin cambio', [['propuesto'], '/A/Cat 3'], [k.validar().map(function (x) { return x.campo; }), k.validar()[0].categoria]);
  k.fijarPct('/A/Cat 3', '101');
  Check('SR3 % fuera de rango', ['propuesto'], k.validar().map(function (x) { return x.campo; }));
  k.fijarPct('/A/Cat 3', '30');
  Check('SR4 % valido', [[], [{ categoria: '/A/Cat 3', anterior: '25', nuevo: '30', nueva: false }], ''],
    [k.validar(), k.resumen().categorias, k.resumen().nuevo]);
  // Varias: otra ligada y dos nuevas, sin repetir.
  k.fijarPct('/A/Cat 1/Hoja', '40');
  Check('SR4b agregar una ligada se rechaza', [false, true], [k.agregarCategoria('/a/cat 3').ok, /ya es una categoría de esta iniciativa/.test(k.agregarCategoria('/A/Cat 3').mensaje)]);
  Check('SR4b agregar una fuera del catalogo se rechaza', false, k.agregarCategoria('/Z/Inventada').ok);
  Check('SR4b agregar del catalogo', [true, '/A/Cat 2'], [k.agregarCategoria(' /a/cat 2 ').ok, k.nuevas[0].categoria]);
  Check('SR4b la misma dos veces se rechaza', [false, 1], [k.agregarCategoria('/A/Cat 2').ok, k.nuevas.length]);
  k.agregarCategoria('/B/Cat 4');
  Check('SR4b nueva sin % se rechaza', ['propuesto', 'propuesto'], k.validar().map(function (x) { return x.campo; }));
  k.capturarPctNueva(0, '15'); k.capturarPctNueva(1, '5');
  Check('SR4b cuatro categorias en una solicitud', [[], ['/A/Cat 1/Hoja', '/A/Cat 3', '/A/Cat 2', '/B/Cat 4'], [false, false, true, true]],
    [k.validar(), k.resumen().categorias.map(function (x) { return x.categoria; }), k.resumen().categorias.map(function (x) { return x.nueva; })]);
  Check('SR4b agregar no cambia los % pedidos de las ligadas', { '/A/Cat 3': '30', '/A/Cat 1/Hoja': '40' }, k.pcts);
  Check('SR4b quitar una nueva', [true, ['/B/Cat 4']], [k.quitarNueva(0), k.nuevas.map(function (x) { return x.categoria; })]);
  k.agregarCategoria('/A/Cat 2'); k.capturarPctNueva(1, '15');
  var sinCat = new S(reg.buscar('PRB 2026-000001'), { rutasEstado: 'cargando' });
  Check('SR4c catalogo cargando: no se agrega y lo dice', [false, true],
    [sinCat.agregarCategoria('/A/Cat 2').ok, /cargando/.test(sinCat.agregarCategoria('/A/Cat 2').mensaje)]);
  Check('SR4c catalogo con error: no se agrega y lo dice', true,
    /No se pudo cargar/.test(new S(reg.buscar('PRB 2026-000001'), { rutasEstado: 'error' }).agregarCategoria('/A/Cat 2').mensaje));

  var o = new S(reg.buscar('PRB 2026-000001'), LISTAS);
  o.campo = 'otros';
  Check('SR5 Otros sin explicacion se rechaza', [['motivo'], 'Explica qué hay que corregir.'],
    [o.validar().map(function (x) { return x.campo; }), o.validar()[0].mensaje]);
  o.motivo = 'Elegi /A/Cat 3 por error; era /A/Cat 2';
  Check('SR5 Otros valido: explicacion, no cambio automatico', [[], false, ''], [o.validar(), o.resumen().automatica, o.resumen().nuevo]);

  var V = R.RevisionSolicitud;
  var rv = new V(c.resumen(), 'SORIANA\\usuario');
  Check('SR6 nace pendiente con su solicitante', ['pendiente', 'SORIANA\\usuario'], [rv.estado, rv.solicitante]);
  Check('SR6 aprobar sin revisor no hace nada', [false, 'pendiente'], [rv.aprobar('').ok, rv.estado]);
  var ap = rv.aprobar('SORIANA\\adm');
  Check('SR7 aprobar fecha: pares de Modificar', [true, 'aprobada', [['accion', 'modificar'], ['folio', 'PRB 2026-000001'], ['f_solucion', '2026-10-15']]],
    [ap.ok, rv.estado, ap.pares]);
  Check('SR7 no se aprueba dos veces ni se rechaza despues', [false, false], [rv.aprobar('x').ok, rv.rechazar('x', 'm').ok]);
  Check('SR8 aprobar Estado: solo el estado (sin subestado)', [['accion', 'modificar'], ['folio', 'PRB 2026-000001'], ['estado', 'Cerrado']],
    new V(e.resumen(), 'u').aprobar('a').pares);
  Check('SR8 aprobar categorias: los mismos pares de Modificar, una por categoria',
    [['accion', 'modificar'], ['folio', 'PRB 2026-000001'], ['pct_categoria', '/A/Cat 1/Hoja'], ['pct_valor', '40'],
     ['pct_categoria', '/A/Cat 3'], ['pct_valor', '30'],
     ['agregar_categoria', '/B/Cat 4'], ['agregar_pct', '5'], ['agregar_categoria', '/A/Cat 2'], ['agregar_pct', '15']],
    new V(k.resumen(), 'u').aprobar('a').pares);
  var ao = new V(o.resumen(), 'u').aprobar('a');
  Check('SR9 aprobar Otros: sin pares, ADM corrige a mano', [true, null, true], [ao.ok, ao.pares, /Modificar/.test(ao.mensaje)]);
  var rj = new V(k.resumen(), 'u');
  Check('SR10 rechazar exige motivo', [false, 'pendiente'], [rj.rechazar('a', ' ').ok, rj.estado]);
  var rr = rj.rechazar('a', 'No procede');
  Check('SR10 rechazada: sin pares, no cambia nada', [true, 'rechazada', null, 'No procede'], [rr.ok, rj.estado, rr.pares, rj.motivoRechazo]);
  Check('SR10 el registro no cambio', [0.25, 'En Solución'],
    [reg.buscar('PRB 2026-000001').categorias[1].pct_dism, reg.buscar('PRB 2026-000001').estado]);

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
    var queCambiar = form.slice(form.indexOf('id="regCambioCampo"'), form.indexOf('</select>', form.indexOf('id="regCambioCampo"')));
    Check('S7 "Qué cambiar": UNA opcion Fecha de compromiso (elegida), sin las tres fechas sueltas', [true, 0, 1],
      [/<option value="fecha" selected>Fecha de compromiso<\/option>/.test(queCambiar), (queCambiar.match(/<option value="f_/g) || []).length,
       (queCambiar.match(/Fecha/g) || []).length]);
    Check('S7 etapa por omision = la del Estado (En Solución) y su fecha actual', [true, false, true, true],
      [/<label for="regCambioFechaCampo">Fecha de compromiso<\/label><select id="regCambioFechaCampo">/.test(form),
       /id="regCambioGrupoEtapa" hidden/.test(form),
       /<option value="f_solucion" selected>Fecha compromiso de Solución<\/option>/.test(form),
       /id="regCambioActual">01\/09\/2026</.test(form)]);

    p.sel('regCambioFechaCampo').value = 'f_analisis';
    p.sel('regDetCuerpo').disparar('change', { target: p.sel('regCambioFechaCampo') });
    Check('S8 cambiar de etapa muestra su fecha actual y nombra la nueva', ['01/12/2026', 'Nueva fecha compromiso de Análisis', 'f_analisis'],
      [p.sel('regCambioActual').textContent, p.sel('regCambioNuevaRot').textContent, p.registro.cambio.campo]);
    p.sel('regCambioFechaCampo').value = 'f_cierre';
    p.sel('regDetCuerpo').disparar('change', { target: p.sel('regCambioFechaCampo') });
    Check('S8 Cierre sin fecha: actual vacia', ['—', 'Nueva fecha compromiso de Cierre'], [p.sel('regCambioActual').textContent, p.sel('regCambioNuevaRot').textContent]);
    p.sel('regCambioCampo').value = 'otros';
    p.sel('regDetCuerpo').disparar('change', { target: p.sel('regCambioCampo') });
    Check('S8 otra opcion oculta la etapa y la nueva fecha', [true, true], [p.sel('regCambioGrupoEtapa').hidden, p.sel('regCambioGrupoFecha').hidden]);
    p.sel('regCambioCampo').value = 'fecha';
    p.sel('regDetCuerpo').disparar('change', { target: p.sel('regCambioCampo') });
    Check('S8 volver a Fecha de compromiso: arranca en la del Estado', [false, 'f_solucion', '01/09/2026'],
      [p.sel('regCambioGrupoEtapa').hidden, p.sel('regCambioFechaCampo').value, p.sel('regCambioActual').textContent]);
    p.sel('regCambioFechaCampo').value = 'f_analisis';
    p.sel('regDetCuerpo').disparar('change', { target: p.sel('regCambioFechaCampo') });

    p.sel('regCambioNueva').value = '';
    p.sel('regCambioMotivo').value = '';
    accion('cambio-agregar');
    Check('S9 cambio invalido: no se agrega; errores y aria-invalid', ['ini-cambio-msg error', 'true', 'false', 0],
      [p.sel('regCambioMsg').className, p.sel('regCambioNueva').getAttribute('aria-invalid'),
       p.sel('regCambioCampo').getAttribute('aria-invalid'), p.registro.lista.items.length]);
    accion('cambio-preparar');
    Check('S9 lista vacia y sin motivo: no se envia ni se prepara', ['ini-cambio-msg error', true, 'true'],
      [p.sel('regCambioMsg').className, /Agrega al menos un cambio/.test(p.sel('regCambioMsg').innerHTML),
       p.sel('regCambioMotivo').getAttribute('aria-invalid')]);

    p.sel('regCambioNueva').value = '2027-01-15';
    p.sel('regCambioMotivo').value = 'Dependencia con proveedor';
    accion('cambio-agregar');
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
      Check('S14 sin eventos de categoria no hay seccion por categoria', false, /Fechas de análisis por categoría/.test(h));

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
    sinOmision(p);
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
    elegir(p, 'regSo', 'SO x');           // filtrar la lista no toca el borrador
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
  Check('H2 Solicitar para ADM y PO/SO vigentes: oculto hasta que SesionAdmin diga solicitante', true,
    /<button type="button" class="btn ini-cta" id="btnSolicitar" data-solo-solicitud hidden>/.test(html));
  Check('H2 [hidden] gana al display del CTA', true,
    /\.btn\.ini-cta\[hidden\] \{ display: none; \}/.test(leer('admin/iniciativas.css')));
  Check('H3 orden de scripts', true,
    /cascada-organizacional\.js[\s\S]*registro-iniciativas\.js[\s\S]*iniciativas\.js"/.test(html));
  Check('H4 sin botones de editar', false, /(Editar|Modificar)/.test(html));
  // Unica descarga: la del registro (XD), deshabilitada hasta que haya filas.
  Check('H4 una sola descarga: Descargar iniciativas', ['⬇ Descargar iniciativas'],
    (html.match(/<button[^>]*>[^<]*Descargar[^<]*<\/button>/g) || []).map(function (b) {
      return /id="regDescargar"[^>]* disabled>/.test(b) ? b.replace(/^.*>([^<]*)<\/button>$/, '$1') : b;
    }));
  Check('H5 sin filtro de Agrupacion', [false, false], [/id="regTipo"/.test(html), /<label[^>]*>Agrupación<\/label>/.test(html)]);
  Check('H5 Tipo de iniciativa sigue como multiselect', true,
    /<label for="regTipoIni">Tipo de iniciativa<\/label>\s*<button type="button" class="ini-multi-boton" id="regTipoIni"/.test(html));
  Check('H7 el detalle sigue rotulado Solo lectura', true, /<span class="ini-hint" id="regDetModo">Solo lectura<\/span>/.test(html));

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
// S16) Historial por categoria (historial_categorias, sql/18): seccion
// aparte; la N del encabezado sigue siendo la de la iniciativa.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var d = JSON.parse(JSON.stringify(DATOS));
  d.historial_estado = 'ok';
  d.historial_desde = '09/10/2026';
  d.iniciativas[0].historial = [
    { id: 1, campo: 'FechaAnalisis', anterior: '2026-10-28', nuevo: '2026-11-10', operacion: 'U', origen: 'ADMIN',
      usuario: 'SORIANA\adm', fecha: '03/11/2026 09:00', reconstruido: false }];
  d.iniciativas[0].historial_categorias = [
    { id: 6, categoria: '/A/Cat 2', campo: 'FechaAnalisis', anterior: null, nuevo: '2026-11-17', operacion: 'I', origen: 'ADMIN',
      usuario: 'SORIANA\adm', fecha: '02/11/2026 10:00', reconstruido: false },
    { id: 7, categoria: '/A/Cat 2', campo: 'FechaAnalisis', anterior: '2026-11-17', nuevo: '2026-11-30', operacion: 'U', origen: 'ADMIN',
      usuario: 'SORIANA\adm', fecha: '03/11/2026 10:00', reconstruido: false }];
  var p = Pagina(ok(d));
  return esperar().then(function () {
    clicFolio(p, 'PRB 2026-000001');
    var h = p.sel('regDetCuerpo').innerHTML;
    Check('S16 N del encabezado: solo la iniciativa (1), aunque haya cambios de categoria', true, /Historial de cambios \(1\)/.test(h));
    Check('S16 seccion por categoria con su propio conteo y la categoria', [true, true],
      [/Fechas de análisis por categoría <span class="ini-sub">1 cambio<\/span>/.test(h), /<td>\/A\/Cat 2<\/td>/.test(h)]);
    Check('S16 anterior null se explica (heredaba), no se rellena; el cambio cuenta como Cambio 1', [true, true],
      [/<td>Fecha propia inicial<\/td><td><span class="ini-origen derivado">Heredaba la de la iniciativa<\/span><\/td><td>17\/11\/2026<\/td>/.test(h),
       /<td><b>Cambio 1<\/b><\/td><td>17\/11\/2026<\/td><td>30\/11\/2026<\/td>/.test(h)]);
  });
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
  function c(cat, op, a, n) { return { categoria: cat, campo: 'FechaAnalisis', anterior: a, nuevo: n, operacion: op }; }
  Check('HF6 categorias: n corre por categoria y campo; la primera fecha propia (anterior null = heredaba) no cuenta',
    ['Fecha propia inicial', 'Fecha propia inicial', 'Cambio 1*', 'Cambio 1*', 'Cambio 2*', 'Fecha propia asignada'],
    rot([c('/A', 'I', null, '2026-11-17'), c('/B', 'I', null, '2026-11-20'), c('/A', 'U', '2026-11-17', '2026-11-30'),
         c('/B', 'U', '2026-11-20', '2026-11-25'), c('/A', 'U', '2026-11-30', '2026-12-05'), c('/C', 'U', null, '2026-12-01')]));
  Check('HF7 la numeracion de la iniciativa no cambia por las categorias (listas separadas, misma regla)',
    ['Cambio 1*', 'Cambio 2*'], rot([u('FechaAnalisis', '2026-01-01', '2026-02-01'), u('FechaAnalisis', '2026-02-01', '2026-03-01')]));
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
      po_capturado: 'PO 1', so_capturado: 'SO x',
      categorias: [Cat('/A/Cat 1/Hoja', 10, 0.1, 'Dir A', 'PO 1', 'SO x')] }),
    Ini('MAP 2026-000120', { prefijo: 'MAP', titulo: 'MIGRACIÓN de correo', po: 'PO 3', so: 'SO z', director: 'Dir B',
      po_capturado: 'PO 3', so_capturado: 'SO z',
      categorias: [Cat('/B/Cat 4', 20, 0.2, 'Dir B', 'PO 3', 'SO z')] }),
    Ini('REQ 2026-001234', { prefijo: 'REQ', titulo: 'Alta de usuarios', po: 'PO 3', so: 'SO z', director: 'Dir B',
      po_capturado: 'PO 3', so_capturado: 'SO z',
      categorias: [Cat('/B/Cat 5', 1, 0.1, 'Dir B', 'PO 3', 'SO z')] }),
    Ini('PRB 2025-000012', { prefijo: 'PRB', titulo: 'Caída del portal', estado: 'Cerrado', activa: false, seguimiento: false,
      po: 'PO 1', so: 'SO x', director: 'Dir A', po_capturado: 'PO 2', so_capturado: 'SO x',
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
    sinOmision(p);
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
    // PRB 2025-000012 tiene 12 pero capturo PO 2: fuera.
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
    // La carga nueva muestra todo: las 4 con '12', Cerrado incluido.
    Check('BV10 recarga: la busqueda escrita se conserva (y la vista por omision es Todas)', [4, '1 filtro activo', '12'],
      [folios(p).length, p.sel('regFiltrosCuenta').textContent, p.sel('regBuscar').value]);
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
    Ini('PRB 2026-000001', { prefijo: 'PRB', po: 'PO 1', so: 'SO x', director: 'Dir A', po_capturado: 'PO 1', so_capturado: 'SO x',
      categorias: [Cat('/A/Cat 1/Hoja', 10, 0.5, 'Dir A', 'PO 1', 'SO x')] }),
    // Su categoria resuelve dueños que solo existen en filas dadas de baja;
    // capturo nombres que tampoco estan en el catalogo vigente.
    Ini('MAP 2026-000002', { prefijo: 'MAP', po: 'PO Viejo', so: 'SO Viejo', director: 'Dir Viejo',
      po_capturado: 'PO Viejo', so_capturado: 'SO Viejo',
      categorias: [Cat('/Z/Baja', 5, 1, 'Dir Viejo', 'PO Viejo', 'SO Viejo')] }),
    // Sin categoria: dueños capturados en el Problem (OwnerProblem...).
    Ini('PRB 2026-000003', { prefijo: 'PRB', sin_categoria: true, categorias: [],
      po: 'Javier Tapia / Yadira Acosta', so: 'Pendiente de asignacion', director: 'Dir B',
      po_capturado: 'Javier Tapia / Yadira Acosta', so_capturado: 'Pendiente de asignacion' }),
    // PO del catalogo pero SO heredado del C1 (resuelto en el servidor).
    Ini('PRB 2026-000004', { prefijo: 'PRB', po: 'PO 3', so: 'SO z', director: 'Dir B', po_capturado: 'PO 3', so_capturado: 'SO z',
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

// ---------------------------------------------------------------------------
// K) Indicadores: registro completo, independientes de filtros y busqueda
// ---------------------------------------------------------------------------
// DATOS: 4 abiertas (PRB 1, MAP 2, REQ 4, PRB 5), 3 Activas (REQ 4 tiene
// agrupacion fuera de las cuatro), 1 Retrasada que cuenta (PRB 1; REQ 4 y
// PRB 5 no), 1 Cerrada (HAR 3).
var KPI_BASE = ['4', '3', '1', '1', '1'];
function rotulosKpi(p) {
  var re = /<div class="lbl">([^<]*)<\/div>/g, m, s = [];
  while ((m = re.exec(p.sel('regKpis').innerHTML))) s.push(m[1]);
  return s;
}
function marcarTipo(p, v) { marcarEn(p, 'regTipoIniPanel', v ? 'data-tipo-ini' : 'data-tipo-todas', v || ''); }

pruebas.push(function () {
  var p = Pagina(ok(DATOS));
  return esperar().then(function () {
    var reg = p.registro, html = p.sel('regKpis').innerHTML;
    Check('K1 cinco indicadores, en orden (Requerimientos en lugar de Fuera de Activas)',
      ['Total iniciativas activas', 'Iniciativas medibles', 'Iniciativas con requerimientos', 'Atrasadas', 'Cerradas'], rotulosKpi(p));
    Check('K1 valores con la vista por omision (Todas)', KPI_BASE, kpis(p));
    Check('K1 pies: abiertas sin categoria, tickets, REQ/RTI/HAR (sin el de ReqOpr), riesgo, Cerrado; ya no la resta',
      [true, true, true, true, true, false],
      [/1 sin categoría/.test(html), /190 tickets a reducir/.test(html), /<div class="foot">REQ, RTI y HAR<\/div>/.test(html) && !/agrupación ReqOpr, abiertos/.test(html),
       /150 tickets en riesgo/.test(html), /estado Cerrado/.test(html), /Total − Activas|Fuera de Activas/.test(html)]);

    // Cada control de la lista, uno tras otro: la lista cambia, los
    // indicadores no (y ni siquiera se repintan).
    var pasos = [], listas = [];
    function paso(nombre, accion) {
      accion();
      listas.push(folios(p).length);
      pasos.push(nombre + ' ' + kpis(p).join('/') + (p.sel('regKpis').innerHTML === html ? '' : ' REPINTADO'));
    }
    paso('Limpiar', function () { sinOmision(p); });
    paso('solo Cerrado', function () { soloEstado(p, 'Cerrado'); });
    paso('solo En Análisis', function () { soloEstado(p, 'En Análisis'); });
    paso('+ Cerrado', function () { marcarEn(p, 'regEstadoPanel', 'data-estado-ini', 'Cerrado'); });
    paso('- Cerrado', function () { marcarEn(p, 'regEstadoPanel', 'data-estado-ini', 'Cerrado'); });
    paso('Todos', function () { soloEstado(p, ''); });
    paso('ningun estado', function () { marcarEn(p, 'regEstadoPanel', 'data-estado-todas', ''); });
    paso('Todos otra vez', function () { soloEstado(p, ''); });
    paso('Tipo HAR', function () { marcarTipo(p, ''); marcarTipo(p, 'HAR'); });
    paso('todos los tipos', function () { marcarTipo(p, ''); });
    paso('Director Dir B', function () { elegir(p, 'regDirector', 'Dir B'); });
    paso('PO 3', function () { elegir(p, 'regPo', 'PO 3'); });
    paso('busqueda MAP', function () { p.sel('regBuscar').value = 'MAP'; reg.aplicarBusqueda(); });
    paso('orden por fecha', function () { reg.ordenarPor('fecha'); });
    paso('Limpiar otra vez', function () { sinOmision(p); });
    Check('K2 ningun filtro, la busqueda ni el orden mueven los indicadores',
      ['Limpiar', 'solo Cerrado', 'solo En Análisis', '+ Cerrado', '- Cerrado', 'Todos', 'ningun estado', 'Todos otra vez',
       'Tipo HAR', 'todos los tipos', 'Director Dir B', 'PO 3', 'busqueda MAP', 'orden por fecha', 'Limpiar otra vez']
        .map(function (n) { return n + ' ' + KPI_BASE.join('/'); }), pasos);
    Check('K2 ... mientras la lista si cambia', [5, 1, 3, 4, 3, 5, 0, 5, 1, 5, 3, 2, 0, 0, 5], listas);
  });
});

// Cerradas solo cuenta Cerrado (sin mayusculas, acentos ni espacios de
// mas); otro estado no activo va a Total y a Fuera de Activas.
pruebas.push(function () {
  var lista = [
    Ini('A 1', { estado: 'En Análisis', retrazado: 1, riesgo_folio: 7, categorias: [Cat('/X', 7, 1)] }),   // activa y retrasada
    Ini('A 2', { estado: 'En Solución', agrup: 'ReqOpr', seguimiento: false, retrazado: 1 }),             // estado activo, agrupacion fuera
    Ini('A 3', { estado: 'En Monitoreo', agrup: null, seguimiento: false }),
    Ini('A 4', { estado: 'En Análisis', sin_categoria: true, retrazado: 1 }),                             // activa sin categoria
    Ini('A 5', { estado: 'Cancelado', activa: false, seguimiento: false }),                              // no activa, NO cerrada
    Ini('A 6', { estado: null, activa: false, seguimiento: false }),
    Ini('A 7', { estado: 'Cerrado', activa: false, seguimiento: false }),
    Ini('A 8', { estado: 'cerrado', activa: false, seguimiento: false }),
    Ini('A 9', { estado: '  CERRADO ', activa: false, seguimiento: false }),
    Ini('A 10', { estado: 'Cerrádo', activa: false, seguimiento: false })
  ];
  var k = R.Registro.indicadores(lista);
  Check('K3 tabla: total/abiertas/activas/fuera de activas/retrasadas/cerradas', [6, 6, 2, 4, 1, 4],
    [k.total, k.abiertas, k.activas, k.fueraActivas, k.retrasadas, k.cerradas]);
  Check('K3 abiertas = Activas + Fuera de Activas; Total = abiertas; Total + Cerradas = todas', [true, true, true],
    [k.abiertas === k.activas + k.fueraActivas, k.abiertas === k.total, k.total + k.cerradas === lista.length]);
  Check('K3 sin categoria y riesgo solo de lo que cuenta', [1, 7], [k.sinCategoria, k.riesgo]);
  var vacio = R.Registro.indicadores([]);
  Check('K3 lista vacia: todo en 0', [0, 0, 0, 0, 0], [vacio.total, vacio.activas, vacio.fueraActivas, vacio.retrasadas, vacio.cerradas]);
});

// Datos nuevos (relectura): los indicadores cambian; filtros, busqueda,
// orden y "mostrar mas" no.
pruebas.push(function () {
  var p = Pagina(ok(DATOS)), reg, antes;
  return esperar().then(function () {
    reg = p.registro;
    elegir(p, 'regDirector', 'Dir A');
    p.sel('regBuscar').value = 'PRB';
    reg.aplicarBusqueda();
    reg.ordenarPor('folio');
    reg.limite = 300;
    antes = [reg.filtro.estados.marcados, reg.filtro.director, reg.filtro.textoBuscado, reg.orden, reg.limite, reg.modo, folios(p)];
    var json = JSON.parse(JSON.stringify(DATOS));
    json.iniciativas[1].estado = 'cerrado';                     // MAP 2 se cierra (en minusculas)
    json.iniciativas[1].activa = false; json.iniciativas[1].seguimiento = false;
    json.iniciativas[2].estado = 'CERRADO';                     // HAR 3 sigue cerrada
    json.iniciativas[3].agrup = 'Mejora';                       // REQ 4 pasa a Activas (y su retraso cuenta)
    json.iniciativas[3].seguimiento = true;
    return reg.actualizar(ok(json));
  }).then(function (r) {
    Check('K4 relectura: Total 3 (abiertas), Activas 3, Requerimientos 0, Atrasadas 2, Cerradas 2', [true, ['3', '3', '0', '2', '2']], [r.ok, kpis(p)]);
    Check('K4 ... pie de riesgo con la nueva retrasada', true, /155 tickets en riesgo/.test(p.sel('regKpis').innerHTML));
    Check('K4 ... filtros, busqueda, orden, "mostrar mas", modo y lista intactos',
      antes, [reg.filtro.estados.marcados, reg.filtro.director, reg.filtro.textoBuscado, reg.orden, reg.limite, reg.modo, folios(p)]);
    // Relectura fallida: se quedan los ultimos valores, nunca 0 ni vacio.
    return reg.actualizar(function () { return Promise.resolve(Respuesta(500, { error: 'error 53' })); });
  }).then(function (r) {
    Check('K5 relectura fallida: los indicadores anteriores siguen (sin ceros)', [false, ['3', '3', '0', '2', '2']], [r.ok, kpis(p)]);
    // Una carga nueva (Reintentar): cargando sin ceros, luego error sin indicadores.
    var promesa = reg.cargar(function () { return Promise.resolve(Respuesta(500, { error: 'error 208' })); });
    Check('K5 cargando: cinco tarjetas "…", ningun 0', [['…', '…', '…', '…', '…'], false],
      [kpis(p), /<div class="val">0<\/div>/.test(p.sel('regKpis').innerHTML)]);
    return promesa;
  }).then(function () {
    Check('K5 error: sin indicadores (ni ceros)', ['', ['regError']], [p.sel('regKpis').innerHTML, visibles(p)]);
    return reg.cargar(ok({ iniciativas: [], estados_activos: [], agrupadores: [] }));
  }).then(function () {
    // Registro vacio NO es error: 0 es el dato real, junto a su aviso.
    Check('K5 registro vacio: su aviso y los indicadores en 0 (dato real)', [['0', '0', '0', '0', '0'], ['regSinDatos']], [kpis(p), visibles(p)]);
    return reg.cargar(ok(DATOS));
  }).then(function () {
    Check('K5 de nuevo con datos: los indicadores vuelven', KPI_BASE, kpis(p));
  });
});

// Globo "Criterio" de Activas: el patron de QARE (GloboAyuda), con el
// criterio armado con lo que manda el servidor.
pruebas.push(function () {
  var p = Pagina(ok(DATOS));
  return esperar().then(function () {
    var reg = p.registro, html = p.sel('regKpis').innerHTML;
    var texto = 'Iniciativas en estado En Análisis, En Solución o En Monitoreo y con agrupación Problem, SorIA, Adopcion o Mejora.';
    var nota = 'Es el criterio de la tabla Activas de Experiencia. Incluye las que no tienen categoría.';
    Check('K6 texto del criterio de Activas', { texto: texto, nota: nota }, reg.ayudaKpi('activas'));
    Check('K6 Activas y Requerimientos llevan la franja "Criterio", con el texto para lectores de pantalla; los demas no', [2, true, true, null],
      [(html.match(/class="ini-kpi-ayuda"/g) || []).length,
       /<div class="kpi ini-kpi sv ini-kpi-ctx[^"]*"><button type="button" class="ini-kpi-ayuda" data-kpi-ayuda="activas"[^>]*>Criterio<\/button>/.test(html)
         && /<div class="lbl">Iniciativas medibles<\/div>/.test(html),
       html.indexOf('id="regKpiAyudaActivas">' + p.ventana.Escape.html(texto + ' ' + nota) + '<') > 0, reg.ayudaKpi('total')]);
    Check('K6 con GloboAyuda no hay title duplicado en la franja', false, /class="ini-kpi-ayuda"[^>]*title=/.test(html));

    // Al pasar el mouse por la franja, el globo dice el criterio.
    var franja = Elemento('franja');
    franja.setAttribute('data-kpi-ayuda', 'activas');
    franja.closest = function (sel) { return sel === '.ini-kpi-ayuda' ? franja : null; };
    p.sel('regKpis').disparar('pointerover', { target: franja, pointerType: 'mouse' });
    var g = reg.globoKpis;
    Check('K6 pasar el mouse: el globo sale con el criterio', [false, texto, nota, true],
      [g.globo.hidden, g.texto.textContent, g.nota.textContent, franja.classList.contains('abierto')]);
    sinOmision(p);
    Check('K6 un filtro no repinta las tarjetas: el globo sigue abierto', false, g.globo.hidden);

    // Otro criterio en el servidor: el texto lo sigue, sin tocar el codigo.
    var json = JSON.parse(JSON.stringify(DATOS));
    json.agrupadores = ['Problem', 'Mejora'];
    return reg.actualizar(ok(json)).then(function () {
      Check('K6 relectura: el globo abierto se cierra al repintar', true, g.globo.hidden);
      Check('K6 el texto sale de agrupadores del servidor',
        'Iniciativas en estado En Análisis, En Solución o En Monitoreo y con agrupación Problem o Mejora.', reg.ayudaKpi('activas').texto);
    });
  });
});

// K7) El hover de Requerimientos es el mismo de Activas: franja "Criterio"
// con GloboAyuda (globo-ayuda.css), no el title nativo de la tarjeta. Mismo
// texto que tenia el title.
pruebas.push(function () {
  var p = Pagina(ok(DATOS));
  return esperar().then(function () {
    var reg = p.registro, html = p.sel('regKpis').innerHTML;
    var texto = 'Requerimientos (REQ/HAR): abiertos, estado distinto de Cerrado, con agrupación ReqOpr.';
    var nota = 'Cuentan en Total, no en Iniciativas medibles.';
    Check('K7 texto del criterio de Requerimientos', { texto: texto, nota: nota }, reg.ayudaKpi('requerimientos'));
    Check('K7 franja Criterio como la de Activas: misma clase, aria-describedby, rotulo y texto para lectores de pantalla',
      [true, true],
      [/<div class="kpi ini-kpi  ini-kpi-ctx[^"]*"><button type="button" class="ini-kpi-ayuda" data-kpi-ayuda="requerimientos" aria-describedby="regKpiAyudaRequerimientos" aria-label="Criterio de Iniciativas con requerimientos">Criterio<\/button><span class="ini-sr" id="regKpiAyudaRequerimientos">[^<]*<\/span><div class="lbl">Iniciativas con requerimientos<\/div>/.test(html),
       html.indexOf('id="regKpiAyudaRequerimientos">' + p.ventana.Escape.html(texto + ' ' + nota) + '<') > 0]);
    Check('K7 sin tooltip nativo: ni la tarjeta de Requerimientos ni su franja llevan title', [false, false],
      [/data-indicador="requerimientos"[^>]*title=/.test(html), /data-kpi-ayuda="requerimientos"[^>]*title=/.test(html)]);

    var franja = Elemento('franja');
    franja.setAttribute('data-kpi-ayuda', 'requerimientos');
    franja.closest = function (sel) { return sel === '.ini-kpi-ayuda' ? franja : null; };
    var g = reg.globoKpis;
    p.sel('regKpis').disparar('pointerover', { target: franja, pointerType: 'mouse' });
    Check('K7 pasar el mouse: el mismo globo (GloboAyuda) con el criterio', [false, 'globo-ayuda', texto, nota, true],
      [g.globo.hidden, g.globo.className.split(' ')[0], g.texto.textContent, g.nota.textContent, franja.classList.contains('abierto')]);
    p.sel('regKpis').disparar('pointerout', { target: franja, pointerType: 'mouse', relatedTarget: null });
    Check('K7 salir con el mouse lo oculta', true, g.globo.hidden);
    p.sel('regKpis').disparar('click', { target: franja });
    Check('K7 la franja no filtra', '', reg.filtro.indicador);
  });
});

// CA) La cuenta del Registro (#regCuenta). Con Cerrado fuera del filtro de
// Estado: "N Abiertas de T Total", N = abiertas que pasan los filtros, T =
// el registro completo (no la pagina). Si no, la cuenta de siempre.
pruebas.push(function () {
  var json = JSON.parse(JSON.stringify(DATOS));
  json.iniciativas = [Ini('A 1', { estado: 'En Análisis' }), Ini('A 2', { estado: 'Cerrado', activa: false }),
    Ini('A 3', { estado: 'cerrado', activa: false })];
  var f = new R.FiltroRegistro(Adm(R.Registro.desdeJson(json)));
  Check('CA1 sin filtro de Estado: no excluye Cerrado', false, f.excluyeCerradas());
  f.alternarEstado('Cerrado');
  Check('CA1 otra variante de Cerrado sigue marcada (plano()): no excluye', false, f.excluyeCerradas());
  f.alternarEstado('cerrado');
  Check('CA1 ninguna variante de Cerrado marcada: excluye', true, f.excluyeCerradas());
  f.limpiar();
  Check('CA1 limpiar: ya no excluye', false, f.excluyeCerradas());
});
pruebas.push(function () {
  var p = Pagina(ok(DATOS));
  return esperar().then(function () {
    Check('CA2 al cargar (Cerrado incluido): la cuenta de siempre', '5 iniciativas', p.sel('regCuenta').textContent);
    marcarEn(p, 'regEstadoPanel', 'data-estado-ini', 'Cerrado');
    Check('CA2 sin Cerrado: abiertas frente al total general; indicadores intactos', ['4 Abiertas de 5 Total', 4, KPI_BASE],
      [p.sel('regCuenta').textContent, folios(p).length, kpis(p)]);
    elegir(p, 'regPo', 'PO 1');
    Check('CA3 con otro filtro: solo las abiertas que pasan, el total no cambia', ['3 Abiertas de 5 Total', 3],
      [p.sel('regCuenta').textContent, folios(p).length]);
    teclear(p, '000005');
    return esperarBusqueda();
  }).then(function () {
    Check('CA3 con busqueda', '1 Abiertas de 5 Total', p.sel('regCuenta').textContent);
    sinOmision(p);
    Check('CA4 Limpiar filtros: la cuenta del registro completo', ['5 iniciativas', 5], [p.sel('regCuenta').textContent, folios(p).length]);
    marcarEn(p, 'regEstadoPanel', 'data-estado-ini', 'En Análisis');
    Check('CA5 Cerrado incluido con otro estado fuera: la cuenta de siempre', true,
      / de 5 iniciativas$/.test(p.sel('regCuenta').textContent));
    sinOmision(p);
    var muchas = JSON.parse(JSON.stringify(DATOS));
    for (var n = 0; n < 230; n++) muchas.iniciativas.push(Ini('X ' + (1000 + n), { categorias: [Cat('/A/Cat 2', 1, 0.1, 'Dir A', 'PO 1', 'SO y')] }));
    return p.registro.cargar(ok(muchas));
  }).then(function () {
    marcarEn(p, 'regEstadoPanel', 'data-estado-ini', 'Cerrado');
    Check('CA6 el total no es la pagina ni el limite', ['234 Abiertas de 235 Total · mostrando 100', 100],
      [p.sel('regCuenta').textContent, folios(p).length]);
  });
});

// ---------------------------------------------------------------------------
// R) Lista: orden de columnas, Atrasada bajo la fecha, dias desde la
//    creacion y desglose de Fuera de Activas
// ---------------------------------------------------------------------------
var COLUMNAS_LISTA = ['Código', 'Título', 'Estado', 'Agrupación', 'Antigüedad', 'Tickets a reducir', 'Fecha compromiso',
  'Service Owner', 'Product Owner'];
function cabeceras(p) {
  var re = /data-orden="[^"]+">([^<]+)</g, m, s = [];
  while ((m = re.exec(p.sel('regCabeza').innerHTML))) s.push(m[1]);
  return s;
}
// Las celdas (data-col) de la fila de un folio, en orden.
function fila(p, folio) {
  var html = p.sel('regCuerpo').innerHTML;
  var k = html.indexOf('<tr class="ini-fila" data-folio="' + folio + '"');
  return html.slice(k, html.indexOf('</tr>', k));
}
function celdas(p, folio) {
  var re = /<td data-col="([^"]+)"/g, m, s = [], h = fila(p, folio);
  while ((m = re.exec(h))) s.push(m[1]);
  return s;
}
function celda(p, folio, col) {
  var h = fila(p, folio), k = h.indexOf('<td data-col="' + col + '"');
  return h.slice(k, h.indexOf('</td>', k));
}
// Por que una abierta queda fuera de Activas, con los datos del servidor
// (activa = estado en estados_activos; seguimiento = activa y agrupacion
// en agrupadores). Lo mismo que se le pide a la VM para el desglose real.
function motivoFuera(i) {
  return !i.activa ? 'estado' : !i.seguimiento ? 'agrupacion' : '';
}
function plano(v) {
  return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

pruebas.push(function () {
  var d = JSON.parse(JSON.stringify(DATOS));
  d.iniciativas.forEach(function (i) {
    if (i.folio === 'PRB 2026-000001') { i.f_creacion = '2026-06-08'; i.antiguedad = 130; }
    if (i.folio === 'MAP 2026-000002') { i.f_creacion = '2026-10-16'; i.antiguedad = 0; }
    if (i.folio === 'REQ 2026-000004') { i.f_creacion = '2025-10-15'; i.antiguedad = 1; }
    // FechaCreacion NULL: el servidor manda antiguedad 0 y f_creacion null.
    if (i.folio === 'PRB 2026-000005') { i.f_creacion = null; i.antiguedad = 0; }
  });
  var p = Pagina(ok(d));
  return esperar().then(function () {
    var reg = p.registro;
    Check('R1 cabecera: orden pedido', COLUMNAS_LISTA, cabeceras(p));
    Check('R1 celdas de cada fila en el mismo orden', [COLUMNAS_LISTA, COLUMNAS_LISTA, COLUMNAS_LISTA],
      [celdas(p, 'PRB 2026-000001'), celdas(p, 'MAP 2026-000002'), celdas(p, 'PRB 2026-000005')]);
    Check('R1 los dueños no cambian de dato: SO capturado en Service Owner, PO capturado en Product Owner', [true, true],
      [/>SO x$/.test(celda(p, 'PRB 2026-000001', 'Service Owner')), />PO 1$/.test(celda(p, 'PRB 2026-000001', 'Product Owner'))]);
    Check('R1 ordenar por Service Owner y Product Owner sigue funcionando', [['so', 'asc'], ['po', 'asc']],
      (function () {
        reg.ordenarPor('so'); var a = [reg.orden.col, reg.orden.dir];
        reg.ordenarPor('po'); var b = [reg.orden.col, reg.orden.dir];
        reg.orden = null; reg.pintarTabla();
        return [a, b];
      })());

    var c1 = celda(p, 'PRB 2026-000001', 'Fecha compromiso');
    Check('R2 Atrasada: fecha y palabra en la MISMA celda, la palabra despues de la fecha', true,
      /ini-sem ambar[^>]*><\/span><b class="ini-vencida">01\/09\/2026<\/b><span class="ini-retraso">Atrasada<\/span>$/.test(c1));
    Check('R2 ninguna "Retrasada" en la lista', false, /Retrasada/i.test(p.sel('regCuerpo').innerHTML));
    Check('R2 en tiempo: solo la fecha, sin indicador', false, /ini-retraso/.test(celda(p, 'MAP 2026-000002', 'Fecha compromiso')));
    var css = leer('admin/iniciativas.css');
    Check('R2 CSS: .ini-retraso es bloque (segunda linea), en mayusculas y ambar', [true, true, true],
      [/\.ini-retraso \{[^}]*display: block/.test(css), /\.ini-retraso \{[^}]*text-transform: uppercase/.test(css),
       /\.ini-retraso \{[^}]*color: #b45309/.test(css)]);

    // La edad va SOLO en la columna Antigüedad (R5): la celda Código lleva
    // el codigo y nada debajo (antes repetia "Hace N días").
    Check('R3 Código: solo el boton del codigo, sin la edad debajo', [true, true, true, true],
      ['PRB 2026-000001', 'MAP 2026-000002', 'REQ 2026-000004', 'PRB 2026-000005'].map(function (f) {
        return new RegExp('^<td data-col="Código"><button [^>]*>' + f + '</button>$').test(celda(p, f, 'Código'));
      }));
    Check('R3 ninguna "Hace N días" / "Creada hoy" en la lista', false,
      /Hace \d|Creada hoy|Sin fecha de creación/.test(p.sel('regCuerpo').innerHTML));
    Check('R3 Título conserva el conteo de categorias debajo', true,
      /<span class="ini-sub">\d+ categorías?<\/span>$/.test(celda(p, 'PRB 2026-000001', 'Título')));
    sinOmision(p);   // HAR 3 esta Cerrado: oculto por omision
    Check('R3 sin dato de f_creacion (servidor anterior): Antigüedad = antiguedad tal cual', '10 días',
      celda(p, 'HAR 2025-000003', 'Antigüedad').replace(/<[^>]+>/g, ''));

    // Columna Antigüedad (a la izquierda de Tickets a reducir): el mismo
    // dato en dias; meses / semanas / dias en el title y en el detalle (R4).
    Check('R5 columna Antigüedad: en dias, — sin fecha de creacion', ['130 días', '0 días', '1 día', '—'],
      ['PRB 2026-000001', 'MAP 2026-000002', 'REQ 2026-000004', 'PRB 2026-000005'].map(function (f) {
        return celda(p, f, 'Antigüedad').replace(/<[^>]+>/g, '');
      }));
    Check('R5 title en meses / semanas / dias; sin title sin dato', [true, false],
      [/title="4 meses, 1 semana y 3 días"/.test(celda(p, 'PRB 2026-000001', 'Antigüedad')),
       /title=/.test(celda(p, 'PRB 2026-000005', 'Antigüedad'))]);
    function ordenEdad() {
      var folios = (p.sel('regCuerpo').innerHTML.match(/<tr class="ini-fila" data-folio="[^"]+"/g) || [])
        .map(function (t) { return t.replace(/.*data-folio="/, '').replace('"', ''); });
      return [reg.orden.col, reg.orden.dir, folios[0], folios[folios.length - 1]];
    }
    reg.ordenarPor('edad');
    Check('R5 Antigüedad, primer clic: ascendente (la mas reciente primero), sin dato al final', ['edad', 'asc', 'MAP 2026-000002', 'PRB 2026-000005'],
      ordenEdad());
    reg.ordenarPor('edad');
    Check('R5 ordenar por Antigüedad: la mas antigua primero, sin dato al final', ['edad', 'desc', 'PRB 2026-000001', 'PRB 2026-000005'],
      (function () {
        var folios = (p.sel('regCuerpo').innerHTML.match(/<tr class="ini-fila" data-folio="[^"]+"/g) || [])
          .map(function (t) { return t.replace(/.*data-folio="/, '').replace('"', ''); });
        return [reg.orden.col, reg.orden.dir, folios[0], folios[folios.length - 1]];
      })());
    reg.orden = null; reg.pintarTabla();

    clicFolio(p, 'PRB 2026-000001');
    var det = p.sel('regDetCuerpo').innerHTML;
    Check('R4 detalle: la misma cifra en Antigüedad y la pastilla Atrasada', [true, true, false],
      [/Antigüedad<\/dt><dd>4 meses, 1 semana y 3 días</.test(det), /<span class="pill ini-atrasada">Atrasada<\/span>/.test(det), /Retrasada/.test(det)]);
    Check('R4 detalle: punto ambar, el texto sigue siendo Atrasada', true, /ini-det-sem[^>]*><span class="ini-sem ambar[^>]*><\/span>Atrasada/.test(det));
    clicFolio(p, 'PRB 2026-000005');
    Check('R4 detalle sin FechaCreacion: Antigüedad "—", no "0 días"', true,
      /Antigüedad<\/dt><dd>—</.test(p.sel('regDetCuerpo').innerHTML));

    // Desglose de Fuera de Activas: cada una tiene motivo y suman el KPI.
    var lista = reg.registro.iniciativas;
    var k = R.Registro.indicadores(lista);
    var fuera = lista.filter(function (i) { return plano(i.estado) !== 'cerrado' && !i.seguimiento; });
    Check('R5 Fuera de Activas = abiertas con motivo (estado o agrupacion)',
      [k.fueraActivas, [['REQ 2026-000004', 'agrupacion']]],
      [fuera.length, fuera.map(function (i) { return [i.folio, motivoFuera(i)]; })]);
  });
});

pruebas.push(function () {
  // Otro estado abierto + agrupacion fuera + agrupacion vacia: los tres
  // caen en Fuera de Activas, cada uno por su motivo.
  var lista = [
    Ini('A 1'),
    Ini('A 2', { estado: 'Pendiente', activa: false, seguimiento: false }),
    Ini('A 3', { agrup: 'ReqOpr', seguimiento: false }),
    Ini('A 4', { agrup: null, seguimiento: false }),
    Ini('A 5', { estado: 'Pendiente', agrup: null, activa: false, seguimiento: false }),
    Ini('A 6', { estado: 'Cerrado', activa: false, seguimiento: false })
  ];
  var k = R.Registro.indicadores(lista);
  var motivos = lista.filter(function (i) { return plano(i.estado) !== 'cerrado' && !i.seguimiento; }).map(motivoFuera);
  Check('R6 desglose: estado, agrupacion, agrupacion vacia, ambos (cuenta por estado)',
    [4, ['estado', 'agrupacion', 'agrupacion', 'estado']], [k.fueraActivas, motivos]);
  Check('R6 abiertas = Activas + Fuera; Cerrada fuera de los dos y de Total', [5, 5, 1, 4, 1],
    [k.total, k.abiertas, k.activas, k.fueraActivas, k.cerradas]);
});

pruebas.push(function () {
  // Relectura tras guardar: la edad y el orden de columnas siguen; la vista
  // (filtros, orden, limite) no se toca.
  var p = Pagina(ok(DATOS)), reg, antes;
  return esperar().then(function () {
    reg = p.registro;
    reg.ordenarPor('fecha');
    reg.limite = 300;
    antes = [reg.filtro.estados.marcados, reg.orden, reg.limite];
    var json = JSON.parse(JSON.stringify(DATOS));
    json.iniciativas[0].antiguedad = 11; json.iniciativas[0].f_creacion = '2026-10-05';
    return reg.actualizar(ok(json));
  }).then(function (r) {
    Check('R7 relectura: edad nueva, columnas en orden, vista intacta',
      [true, '11 días', COLUMNAS_LISTA, antes],
      [r.ok, celda(p, 'PRB 2026-000001', 'Antigüedad').replace(/<[^>]+>/g, ''), cabeceras(p),
       [reg.filtro.estados.marcados, reg.orden, reg.limite]]);
  });
});

// ---------------------------------------------------------------------------
// SF) Semaforo junto al titulo Registro: registro COMPLETO, solo activas
// ---------------------------------------------------------------------------
function semaforoTexto(p) {
  var re = /data-semaforo="([^"]+)"[^>]*><span class="ini-sem ([a-z]+)"[^>]*><\/span>([^<]+) <b>([^<]+)<\/b>/g, m, s = [];
  while ((m = re.exec(p.sel('regSemaforo').innerHTML))) s.push(m[1] + ':' + m[2] + ':' + m[3] + ':' + m[4]);
  return s;
}

pruebas.push(function () {
  var S = R.Registro.semaforoFecha;
  Check('SF1 categoria por iniciativa', [null, 'sin_control', 'sin_control', 'atrasada', 'sin_fecha', 'en_tiempo', 'sin_fecha', 'en_tiempo'], [
    S(Ini('a', { estado: 'Cerrado', activa: false, seguimiento: false })),
    S(Ini('b', { prefijo: 'REQ', control_fecha: false, f_analisis: null })),
    S(Ini('c', { control_fecha: false, fecha_retrasada: true })),          // sin control nunca es atrasada
    S(Ini('d', { fecha_retrasada: true, f_analisis: '2026-01-01' })),
    S(Ini('e', { control_fecha: true, f_analisis: null })),
    S(Ini('f', { control_fecha: true })),
    S(Ini('g', { estado: 'En Solución', f_analisis: '2026-12-01', f_solucion: null })),  // la fecha es la de SU estado
    S(Ini('h', {}))                                                        // sin control_fecha (servidor anterior) = con control
  ]);
  // Sin control de fecha NO es Sin fecha ni En tiempo (ver la cabecera de
  // registro-iniciativas.js): una REQ/RTI con fecha vigente, vencida o sin
  // ella sigue en gris; ninguna suma al rojo de "Sin fecha".
  Check('SF7 sin control: gris con fecha vigente, vencida o sin fecha; nunca sin_fecha ni en_tiempo',
    ['sin_control', 'sin_control', 'sin_control'], [
      S(Ini('r1', { prefijo: 'REQ', control_fecha: false, f_analisis: '2099-12-31' })),
      S(Ini('r2', { prefijo: 'RTI', control_fecha: false, f_analisis: '2020-01-01', fecha_retrasada: false })),
      S(Ini('r3', { prefijo: 'REQ', control_fecha: false, f_analisis: null }))]);
  Check('SF7 cuenta: las sin control no inflan Sin fecha ni En tiempo',
    { sin_fecha: 1, atrasada: 0, en_tiempo: 1, sin_control: 2 },
    R.Registro.semaforo([Ini('1', { f_analisis: null }), Ini('2'),
      Ini('3', { control_fecha: false, f_analisis: null }), Ini('4', { control_fecha: false })]));
  Check('SF1 cuenta: solo activas; Cerrado y otros estados no entran',
    { sin_fecha: 1, atrasada: 1, en_tiempo: 1, sin_control: 1 },
    R.Registro.semaforo([Ini('1', { f_analisis: null }), Ini('2', { fecha_retrasada: true }), Ini('3'),
      Ini('4', { control_fecha: false }), Ini('5', { estado: 'Cerrado', activa: false }), Ini('6', { estado: 'Pendiente', activa: false })]));
});

pruebas.push(function () {
  var d = JSON.parse(JSON.stringify(DATOS));
  var p = Pagina(ok(d)), reg, html0;
  return esperar().then(function () {
    reg = p.registro;
    html0 = p.sel('regSemaforo').innerHTML;
    // DATOS: PRB 1, REQ 4 y PRB 5 atrasadas; MAP 2 en tiempo; HAR 3 cerrada.
    Check('SF2 orden, colores y cuentas; sin "Sin control" cuando no hay',
      ['sin_fecha:rojo:Sin fecha:0', 'atrasada:ambar:Atrasadas:3', 'en_tiempo:verde:En tiempo:1'], semaforoTexto(p));
    var cab = leer('admin/iniciativas.html');
    Check('SF2 en la cabecera de Registro, a la derecha; la ayuda debajo', true,
      /<h3 class="ini-lista-titulo">Registro<\/h3>[\s\S]*?<div class="ini-lista-lado">\s*<div class="ini-semaforo" id="regSemaforo"[^>]*><\/div>\s*<span class="ini-lista-ayuda">Elige una iniciativa para ver su detalle.<\/span>/.test(cab));
    var css = leer('admin/iniciativas.css');
    Check('SF2 CSS: lado a la derecha en columna, alineado a la derecha; punto gris', [true, true],
      [/\.ini-lista-lado \{[^}]*margin-left: auto;[^}]*flex-direction: column;[^}]*align-items: flex-end/.test(css), /\.ini-sem\.gris \{/.test(css)]);

    soloEstado(p, 'Cerrado');
    elegir(p, 'regDirector', 'Dir B');
    p.sel('regBuscar').value = 'REQ'; reg.aplicarBusqueda();
    reg.ordenarPor('fecha');
    Check('SF3 filtros, busqueda y orden no lo mueven (ni lo repintan)', html0, p.sel('regSemaforo').innerHTML);
    sinOmision(p);
    Check('SF6 punto de la fila = color del semaforo: Atrasada ambar, En tiempo verde; no activa sin cambio (verde)',
      ['ambar', 'verde', 'ambar', 'verde'],
      ['PRB 2026-000001', 'MAP 2026-000002', 'PRB 2026-000005', 'HAR 2025-000003'].map(function (f) {
        return (/class="ini-sem ([a-z]+)"/.exec(celda(p, f, 'Fecha compromiso')) || [])[1];
      }));
    Check('SF6 tarjeta Atrasadas en ambar (sa), no roja', true,
      /<div class="kpi ini-kpi sa[ "][^>]*><div class="lbl">Atrasadas</.test(p.sel('regKpis').innerHTML));
    sinOmision(p);

    var json = JSON.parse(JSON.stringify(DATOS));
    json.iniciativas[3].control_fecha = false;                      // REQ 4: sin control de fecha
    json.iniciativas[1].f_analisis = null;                          // MAP 2: sin fecha
    return reg.actualizar(ok(json));
  }).then(function () {
    Check('SF4 relectura: cuentas nuevas y aparece "Sin control de fecha" en gris',
      ['sin_fecha:rojo:Sin fecha:1', 'atrasada:ambar:Atrasadas:2', 'en_tiempo:verde:En tiempo:0',
       'sin_control:gris:Sin control de fecha:1'], semaforoTexto(p));
    Check('SF6 relectura: Sin fecha rojo, Sin control gris en la fila', ['rojo', 'gris'],
      ['MAP 2026-000002', 'REQ 2026-000004'].map(function (f) {
        return (/class="ini-sem ([a-z]+)"/.exec(celda(p, f, 'Fecha compromiso')) || [])[1];
      }));
    Check('SF4 la fila dice lo mismo: MAP 2 (con control) "Sin fecha"', true,
      /Sin fecha$/.test(celda(p, 'MAP 2026-000002', 'Fecha compromiso')));
    var p2 = Pagina(ok({ estados_activos: DATOS.estados_activos, agrupadores: DATOS.agrupadores,
      iniciativas: [Ini('REQ 2026-000009', { control_fecha: false, f_analisis: null })] }));
    return esperar().then(function () {
      Check('SF4 sin control y sin fecha: la celda dice "Sin control de fecha"', true,
        /<span class="ini-tenue">Sin control de fecha<\/span>$/.test(celda(p2, 'REQ 2026-000009', 'Fecha compromiso')));
    });
  }).then(function () {
    var promesa = p.registro.cargar(function () { return Promise.resolve(Respuesta(500, { error: 'x' })); });
    Check('SF5 cargando: vacio (sin ceros)', '', p.sel('regSemaforo').innerHTML);
    return promesa;
  }).then(function () {
    Check('SF5 error: vacio', '', p.sel('regSemaforo').innerHTML);
  });
});

// ---------------------------------------------------------------------------
// RQ) Requerimientos = abiertas con agrupacion ReqOpr, NO Total - Activas
// ---------------------------------------------------------------------------
var REQ_LISTA = [
  Ini('PRB 1'),                                                               // Activa
  Ini('ADO 2', { agrup: 'Adopcion' }),                                        // Activa (el servidor ya canonizo "Adopción")
  Ini('REQ 3', { agrup: 'ReqOpr', seguimiento: false }),                      // Requerimiento
  Ini('HAR 4', { agrup: ' REQOPR ', estado: 'En Solución', seguimiento: false }), // Requerimiento (mayusculas/espacios)
  Ini('REQ 5', { agrup: 'ReqOpr', estado: 'Pendiente', activa: false, seguimiento: false }), // abierto en otro estado: cuenta
  Ini('REQ 6', { agrup: 'ReqOpr', estado: 'Cerrado', activa: false, seguimiento: false }),   // cerrado: no cuenta
  Ini('PRB 7', { estado: 'Pendiente', activa: false, seguimiento: false }),  // fuera de Activas, NO requerimiento
  Ini('HAR 8', { agrup: 'Adopcion', prefijo: 'HAR' }),                       // HAR con Adopcion: Activa, no requerimiento
  Ini('REQ 9', { agrup: 'Requerimiento', sin_categoria: true, seguimiento: false }) // otra agrupacion: no cuenta
];

pruebas.push(function () {
  var k = R.Registro.indicadores(REQ_LISTA);
  Check('RQ1 Total 8 (abiertas), abiertas 8, Activas 3, Requerimientos 3, Cerradas 1', [8, 8, 3, 3, 1], [k.total, k.abiertas, k.activas, k.requerimientos, k.cerradas]);
  Check('RQ1 Requerimientos NO es abiertas - Activas (5)', [5, false], [k.fueraActivas, k.requerimientos === k.abiertas - k.activas]);
  Check('RQ1 Requerimientos y Activas no se pisan', [],
    REQ_LISTA.filter(function (i) { return i.seguimiento && R.Registro.esRequerimiento(i); }).map(function (i) { return i.folio; }));
  Check('RQ1 esRequerimiento: ReqOpr sin importar mayusculas/espacios; no por prefijo ni por TipoIniciativa',
    [true, true, false, false], [R.Registro.esRequerimiento(REQ_LISTA[2]), R.Registro.esRequerimiento(REQ_LISTA[3]),
      R.Registro.esRequerimiento(REQ_LISTA[7]), R.Registro.esRequerimiento(REQ_LISTA[8])]);
});

pruebas.push(function () {
  var d = { estados_activos: DATOS.estados_activos, agrupadores: DATOS.agrupadores, tipos_iniciativa: DATOS.tipos_iniciativa,
    iniciativas: JSON.parse(JSON.stringify(REQ_LISTA)) };
  var p = Pagina(ok(d)), reg, base;
  return esperar().then(function () {
    reg = p.registro;
    base = kpis(p);
    Check('RQ2 tarjetas: Total 8 (abiertas), Activas 3, Requerimientos 3, Atrasadas 0, Cerradas 1', ['8', '3', '3', '0', '1'], base);
    var html = p.sel('regKpis').innerHTML;
    soloEstado(p, 'Cerrado');
    p.sel('regBuscar').value = 'REQ'; reg.aplicarBusqueda();
    marcarTipo(p, ''); marcarTipo(p, 'PRB');
    reg.ordenarPor('agrup');
    Check('RQ2 filtros, busqueda y orden no mueven (ni repintan) las tarjetas', [base, true], [kpis(p), p.sel('regKpis').innerHTML === html]);
  });
});

// ---------------------------------------------------------------------------
// O) Orden por omision (f_creacion) y orden por columna
// ---------------------------------------------------------------------------
function clicColumna(p, col) {
  var th = Elemento('th');
  th.setAttribute('data-orden', col);
  p.sel('regCabeza').disparar('click', { target: th });
}
function ariaDe(p, col) {
  var m = new RegExp('aria-sort="([a-z]+)"><button type="button" class="ini-orden" data-orden="' + col + '"').exec(p.sel('regCabeza').innerHTML);
  return m ? m[1] : null;
}
var POR_CREACION = ['PRB 2026-000001', 'REQ 2026-000004', 'MAP 2026-000002', 'PRB 2026-000005', 'HAR 2025-000003'];

pruebas.push(function () {
  var lista = [
    { folio: 'C 3', f_creacion: '2026-03-01' }, { folio: 'Z 9', f_creacion: null },
    { folio: 'B 2', f_creacion: '2026-03-01' }, { folio: 'X 7', f_creacion: '2026-13-40' },
    { folio: 'A 1', f_creacion: '2025-12-31' }, { folio: 'Y 8', f_creacion: 'ayer' },
    { folio: 'W 6' }, { folio: 'V 5', f_creacion: '' }, { folio: 'D 4', f_creacion: '2026-10-20' }
  ];
  var esperado = ['A 1', 'B 2', 'C 3', 'D 4', 'V 5', 'W 6', 'X 7', 'Y 8', 'Z 9'];
  var orden = function (l, o) { return R.ordenar(l, o).map(function (i) { return i.folio; }); };
  Check('O1 por omision: f_creacion ascendente, la mas antigua primero', ['A 1', 'B 2', 'C 3', 'D 4'], orden(lista, null).slice(0, 4));
  Check('O2 sin fecha, vacia o invalida (2026-13-40, "ayer"): al final', ['V 5', 'W 6', 'X 7', 'Y 8', 'Z 9'], orden(lista, null).slice(4));
  Check('O3 empates (misma fecha, o todas sin fecha): por Codigo, sin depender del orden de llegada',
    [esperado, esperado], [orden(lista, null), orden(lista.slice().reverse(), null)]);
  Check('O3b una columna con empate desempata por fecha de creacion', ['A 1', 'B 2', 'C 3'],
    orden([lista[0], lista[2], lista[4]].map(function (i) { return { folio: i.folio, f_creacion: i.f_creacion, estado: 'X' }; }),
          { col: 'estado', dir: 'asc' }));
});

pruebas.push(function () {
  var p = Pagina(ok(DATOS)), reg;
  return esperar().then(function () {
    reg = p.registro;
    Check('O4 al cargar: orden por omision (f_creacion), sin columna marcada', [POR_CREACION, null, 'none'],
      [folios(p), reg.orden, ariaDe(p, 'folio')]);

    // asc -> desc -> por omision, en cualquier columna.
    clicColumna(p, 'folio');
    Check('O5 primer clic: ascendente', [{ col: 'folio', dir: 'asc' }, 'ascending', 'HAR 2025-000003'], [reg.orden, ariaDe(p, 'folio'), folios(p)[0]]);
    clicColumna(p, 'folio');
    Check('O5 segundo clic: descendente', [{ col: 'folio', dir: 'desc' }, 'descending', 'REQ 2026-000004'], [reg.orden, ariaDe(p, 'folio'), folios(p)[0]]);
    clicColumna(p, 'folio');
    Check('O5 tercer clic: vuelve al orden por omision', [null, 'none', POR_CREACION], [reg.orden, ariaDe(p, 'folio'), folios(p)]);
    clicColumna(p, 'reduce');
    Check('O5 columna numerica: tambien empieza ascendente', [{ col: 'reduce', dir: 'asc' }, 'ascending'], [reg.orden, ariaDe(p, 'reduce')]);
    clicColumna(p, 'folio');
    Check('O5 otra columna: empieza otra vez en ascendente', [{ col: 'folio', dir: 'asc' }, 'none'], [reg.orden, ariaDe(p, 'reduce')]);

    // Cada filtro y la busqueda conservan el orden elegido.
    clicColumna(p, 'folio');                                   // desc
    elegir(p, 'regPo', 'PO 1');
    Check('O6 cambiar un filtro (PO) conserva el orden', [{ col: 'folio', dir: 'desc' }, ['PRB 2026-000005', 'PRB 2026-000001', 'MAP 2026-000002']],
      [reg.orden, folios(p)]);
    p.sel('regBuscar').value = 'PRB';
    reg.aplicarBusqueda();
    Check('O6 la busqueda conserva el orden', [{ col: 'folio', dir: 'desc' }, ['PRB 2026-000005', 'PRB 2026-000001']], [reg.orden, folios(p)]);
    elegir(p, 'regPo', '');
    Check('O6 quitar un filtro conserva el orden', [{ col: 'folio', dir: 'desc' }, ['PRB 2026-000005', 'PRB 2026-000001']], [reg.orden, folios(p)]);
    p.sel('regBuscar').value = '';
    reg.aplicarBusqueda();
    soloEstado(p, 'En Análisis');
    Check('O6 filtro de estado conserva el orden', [{ col: 'folio', dir: 'desc' }, ['REQ 2026-000004', 'PRB 2026-000005', 'MAP 2026-000002']],
      [reg.orden, folios(p)]);
    marcarTipo(p, ''); marcarTipo(p, 'REQ'); marcarTipo(p, 'MAP');
    Check('O6 filtro de tipo conserva el orden', [{ col: 'folio', dir: 'desc' }, ['REQ 2026-000004', 'MAP 2026-000002']], [reg.orden, folios(p)]);

    // Limpiar filtros: tambien quita el orden por columna.
    p.sel('regBuscar').value = 'PRB';
    reg.aplicarBusqueda();
    p.sel('regLimpiar').disparar('click');
    Check('O7 Limpiar filtros: sin filtros ni busqueda y orden por omision', [null, '', 0, POR_CREACION, 'none'],
      [reg.orden, p.sel('regBuscar').value, reg.filtro.activos(), folios(p), ariaDe(p, 'folio')]);
    clicColumna(p, 'titulo');
    soloEstado(p, 'Cerrado');
    elegir(p, 'regPo', 'PO 1');
    p.sel('regLimpiarVacio').disparar('click');
    Check('O7 Limpiar desde "sin coincidencias": tambien', [null, POR_CREACION], [reg.orden, folios(p)]);
  });
});

// Relectura (lo que corre tras guardar): el orden elegido sigue y lo
// cambiado se reacomoda; sin orden elegido, el de f_creacion.
pruebas.push(function () {
  var p = Pagina(ok(DATOS)), reg;
  return esperar().then(function () {
    reg = p.registro;
    elegir(p, 'regDirector', 'Dir A');
    clicColumna(p, 'titulo');
    Check('O8 antes: titulo asc con filtro Dir A', ['MAP 2026-000002', 'PRB 2026-000001'], folios(p));
    var json = JSON.parse(JSON.stringify(DATOS));
    json.iniciativas[0].titulo = 'A primera';                   // PRB 1 cambia de titulo
    return reg.actualizar(ok(json));
  }).then(function (r) {
    Check('O8 relectura: mismo orden y filtro; PRB 1 se reacomoda por su titulo nuevo',
      [true, { col: 'titulo', dir: 'asc' }, 'Dir A', ['PRB 2026-000001', 'MAP 2026-000002']],
      [r.ok, reg.orden, reg.filtro.director, folios(p)]);
    clicColumna(p, 'titulo'); clicColumna(p, 'titulo');       // desc -> por omision
    elegir(p, 'regDirector', '');
    var json = JSON.parse(JSON.stringify(DATOS));
    json.iniciativas[0].f_creacion = '2026-06-01';              // PRB 1 pasa a la mas reciente
    return reg.actualizar(ok(json));
  }).then(function () {
    Check('O9 relectura sin orden elegido: por f_creacion con los datos nuevos',
      [null, ['REQ 2026-000004', 'MAP 2026-000002', 'PRB 2026-000005', 'HAR 2025-000003', 'PRB 2026-000001']], [reg.orden, folios(p)]);
  });
});

// ---------------------------------------------------------------------------
// AC) Acuse del PO / SO: abrir un detalle se lo pasa a AcuseDetalle con su
//     contenedor (#regAcuse, nace oculto); sin modulo, nada cambia.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var p = Pagina(ok(JSON.parse(JSON.stringify(DATOS)))), reg = p.registro, llamadas = [];
  return esperar().then(function () {
    clicFolio(p, 'PRB 2026-000001');
    Check('AC1 sin modulo de acuse: el detalle abre igual, con su contenedor oculto', [true, 'PRB 2026-000001'],
      [/<div id="regAcuse" hidden><\/div>/.test(p.sel('regDetCuerpo').innerHTML), reg.abierta]);
    reg.cerrarDetalle(true);
    reg.acuse = { mostrar: function (i, caja) { llamadas.push([i.folio, caja && caja.id]); } };
    clicFolio(p, 'MAP 2026-000002');
    Check('AC2 con modulo: mostrar(iniciativa, #regAcuse) una vez por detalle abierto', [['MAP 2026-000002', 'regAcuse']], llamadas);
  });
});

// ---------------------------------------------------------------------------
// KF) Indicadores y semaforo como filtro: un clic acota la lista, otro en el
//     mismo lo quita; las cifras no se mueven; se combina en Y con los demas
//     filtros sin tocarlos; relectura, Cobertura, foco y la instruccion.
// ---------------------------------------------------------------------------
function clicIndicador(p, k) {
  var el = Elemento('indicador');
  el.setAttribute('data-indicador', k);
  p.sel(/^sem_/.test(k) ? 'regSemaforo' : 'regKpis').disparar('click', { target: el });
}
// Los indicadores marcados (aria-pressed="true"), tarjetas y semaforo.
function pulsados(p) {
  var re = /data-indicador="([^"]+)" aria-pressed="true"/g, m, s = [];
  var html = p.sel('regKpis').innerHTML + p.sel('regSemaforo').innerHTML;
  while ((m = re.exec(html))) s.push(m[1]);
  return s;
}
var CINCO = ['PRB 2026-000001', 'REQ 2026-000004', 'MAP 2026-000002', 'PRB 2026-000005', 'HAR 2025-000003'];

pruebas.push(function () {
  var reg = Adm(R.Registro.desdeJson(JSON.parse(JSON.stringify(DATOS))));
  var k = R.Registro.indicadores(reg.iniciativas);
  Check('KF0 cada tarjeta filtra con la MISMA regla con la que cuenta',
    [k.total, k.activas, k.requerimientos, k.retrasadas, k.cerradas],
    ['total', 'activas', 'requerimientos', 'retrasadas', 'cerradas'].map(function (c) {
      return reg.iniciativas.filter(function (i) { return R.Registro.cumpleIndicador(c, i); }).length;
    }));
  var sem = R.Registro.semaforo(reg.iniciativas);
  Check('KF0 cada categoria del semaforo filtra con la misma regla con la que cuenta',
    [sem.sin_fecha, sem.atrasada, sem.en_tiempo, sem.sin_control],
    ['sem_sin_fecha', 'sem_atrasada', 'sem_en_tiempo', 'sem_sin_control'].map(function (c) {
      return reg.iniciativas.filter(function (i) { return R.Registro.cumpleIndicador(c, i); }).length;
    }));
  var f = new R.FiltroRegistro(reg);
  f.alternarIndicador('inventado');
  Check('KF0 un indicador que no existe no se elige', ['', 0], [f.indicador, f.activos()]);
});

pruebas.push(function () {
  var p = Pagina(nunca), reg = p.registro;
  Check('KF1 cargando: sin instruccion', true, p.sel('regKpisGuia').hidden);
  var q = Pagina(function () { return Promise.resolve(Respuesta(500, { error: 'x' })); });
  return esperar().then(function () {
    Check('KF1 error: sin instruccion', true, q.sel('regKpisGuia').hidden);
    var html = leer('admin/iniciativas.html');
    Check('KF1 la instruccion va justo encima de las tarjetas, sin globo', true,
      /<p class="ini-kpis-guia" id="regKpisGuia" hidden>\s*<strong>Haz clic en un indicador para filtrar las iniciativas por esa condición\.<\/strong>\s*<span>Vuelve a hacer clic en el indicador seleccionado para quitar el filtro\.<\/span>\s*<span>Total muestra todas las iniciativas\.<\/span>\s*<\/p>\s*<div class="kpis ini-kpis" id="regKpis"/.test(html));
    // Las tarjetas se repintan en cada clic: NO son aria-live (se releerian
    // enteras); el aviso es la cuenta de la lista, que si lo es.
    Check('KF1 tarjetas sin aria-live; #regCuenta aria-live; helper cargado antes del registro', [false, true, true],
      [/id="regKpis"[^>]*aria-live/.test(html), /id="regCuenta" aria-live="polite"/.test(html),
       /<script src="\.\.\/assets\/js\/seleccion-kpi\.js"><\/script>[\s\S]*<script src="registro-iniciativas\.js">/.test(html)]);
    p = Pagina(ok(JSON.parse(JSON.stringify(DATOS)))); reg = p.registro;
    return esperar();
  }).then(function () {
    var cifras = kpis(p);
    Check('KF1 listo: instruccion visible; nada elegido; cinco tarjetas filtrables', [false, [], 5],
      [p.sel('regKpisGuia').hidden, pulsados(p), (p.sel('regKpis').innerHTML.match(/class="kpi-filtro" data-indicador=/g) || []).length]);
    // Total no es un estado: sin aria-pressed (las otras cuatro si).
    Check('KF1 Total sin aria-pressed; las demas con aria-pressed="false"', [false, 4],
      [/data-indicador="total" aria-pressed/.test(p.sel('regKpis').innerHTML),
       (p.sel('regKpis').innerHTML.match(/data-indicador="[a-z]+" aria-pressed="false"/g) || []).length]);
    var esperado = {
      activas: ['PRB 2026-000001', 'MAP 2026-000002', 'PRB 2026-000005'],
      requerimientos: ['REQ 2026-000004'],
      retrasadas: ['PRB 2026-000001'],
      cerradas: ['HAR 2025-000003']
    };
    Object.keys(esperado).forEach(function (c) {
      clicIndicador(p, c);
      Check('KF2 ' + c + ': filtra la lista, la marca, cifras y semaforo iguales',
        [esperado[c], [c], 1, cifras, 1],
        [folios(p), pulsados(p), (p.sel('regKpis').innerHTML.match(/kpi-sel/g) || []).length, kpis(p),
         reg.filtro.activos()]);
      clicIndicador(p, c);
      Check('KF2 ' + c + ': otro clic lo quita', [CINCO, [], cifras, 0], [folios(p), pulsados(p), kpis(p), reg.filtro.activos()]);
    });

    // Total: cuenta las abiertas, pero su clic no filtra. Sin nada elegido
    // no cambia nada (ni la pagina); con algo elegido lo quita y la lista
    // vuelve a todas (Cerradas incluidas).
    Check('KF2T la cifra de Total = las abiertas; la lista sin indicador, todas', ['4', 5], [cifras[0], CINCO.length]);
    reg.limite = 300;
    clicIndicador(p, 'total');
    Check('KF2T Total sin nada elegido: todas, nada marcado, ningun filtro, pagina intacta',
      [CINCO, [], '', 0, 300, cifras], [folios(p), pulsados(p), reg.filtro.indicador, reg.filtro.activos(), reg.limite, kpis(p)]);
    reg.limite = 100;
    clicIndicador(p, 'retrasadas');
    clicIndicador(p, 'total');
    Check('KF2T Total con Atrasadas elegida: la quita y vuelve a todas (HAR cerrada incluida)',
      [CINCO, [], '', true, '5 iniciativas'], [folios(p), pulsados(p), reg.filtro.indicador,
        folios(p).indexOf('HAR 2025-000003') >= 0, p.sel('regCuenta').textContent]);
    // Con un filtro independiente: Total quita solo el indicador.
    elegir(p, 'regDirector', 'Dir B');
    clicIndicador(p, 'cerradas');
    clicIndicador(p, 'total');
    Check('KF2T Total con Director Dir B: quita el indicador, el Director sigue (Cerrada incluida)',
      ['', 'Dir B', ['REQ 2026-000004', 'PRB 2026-000005', 'HAR 2025-000003'], '1 filtro activo'],
      [reg.filtro.indicador, reg.filtro.director, folios(p), p.sel('regFiltrosCuenta').textContent]);
    sinOmision(p);

    clicIndicador(p, 'activas'); clicIndicador(p, 'cerradas');
    Check('KF3 elegir otro reemplaza al anterior', [['cerradas'], ['HAR 2025-000003']], [pulsados(p), folios(p)]);
    Check('KF3 la cuenta y el filtro lo dicen', ['1 de 5 iniciativas · indicador: Cerradas', '1 filtro activo', false],
      [p.sel('regCuenta').textContent, p.sel('regFiltrosCuenta').textContent, p.sel('regLimpiar').hidden]);
    p.sel('regLimpiar').disparar('click');
    Check('KF3 Limpiar filtros tambien lo quita', [[], CINCO], [pulsados(p), folios(p)]);
    // Un indicador, luego a mano otro (el semaforo) y el Director: Limpiar
    // quita todo y ninguna tarjeta ni punto del semaforo queda marcado.
    clicIndicador(p, 'activas');
    clicIndicador(p, 'sem_atrasada');
    elegir(p, 'regDirector', 'Dir B');
    Check('KF3b antes: el semaforo reemplazo a la tarjeta, con Director', [['sem_atrasada'], 'sem_atrasada', 'Dir B'],
      [pulsados(p), reg.filtro.indicador, reg.filtro.director]);
    p.sel('regLimpiar').disparar('click');
    var cajas = p.sel('regKpis').innerHTML + p.sel('regSemaforo').innerHTML;
    Check('KF3b Limpiar: sin indicador ni Director, todas, sin kpi-sel y todo aria-pressed="false"',
      ['', '', CINCO, [], false, false, true],
      [reg.filtro.indicador, reg.filtro.director, folios(p), pulsados(p), /kpi-sel/.test(p.sel('regKpis').innerHTML),
       /aria-pressed="true"/.test(cajas), /aria-pressed="false"/.test(cajas)]);

    // Criterio (franja de Activas) no filtra.
    var franja = Elemento('franja');
    franja.setAttribute('data-kpi-ayuda', 'activas');
    p.sel('regKpis').disparar('click', { target: franja });
    Check('KF4 la franja Criterio no filtra', [[], CINCO], [pulsados(p), folios(p)]);

    // Busqueda, orden y pagina.
    p.sel('regBuscar').value = 'PRB'; reg.aplicarBusqueda();
    reg.ordenarPor('folio'); reg.ordenarPor('folio');          // desc
    reg.limite = 300;
    clicIndicador(p, 'activas');
    Check('KF5 con busqueda y orden: los conserva, vuelve a la primera pagina',
      ['PRB', { col: 'folio', dir: 'desc' }, 100, ['PRB 2026-000005', 'PRB 2026-000001'], cifras, '2 filtros activos'],
      [reg.filtro.textoBuscado, reg.orden, reg.limite, folios(p), kpis(p), p.sel('regFiltrosCuenta').textContent]);
    clicIndicador(p, 'activas');
    Check('KF5 quitarlo deja la busqueda y el orden', ['PRB', { col: 'folio', dir: 'desc' }, ['PRB 2026-000005', 'PRB 2026-000001'], 'PRB'],
      [reg.filtro.textoBuscado, reg.orden, folios(p), p.sel('regBuscar').value]);
    sinOmision(p);

    // Choque con Estado: Y, sin tocar Estado; la lista vacia lo dice.
    soloEstado(p, 'En Análisis');
    clicIndicador(p, 'cerradas');
    Check('KF6 Cerradas con Estado = En Análisis: lista vacia que lo explica, Estado intacto',
      [[], false, 'No hay iniciativas que coincidan con el indicador «Cerradas» y los filtros seleccionados.', ['En Análisis'], cifras],
      [folios(p), p.sel('regVacio').hidden, p.sel('regVacioTexto').textContent, reg.filtro.estadosMarcados(), kpis(p)]);
    p.sel('regBuscar').value = 'zzz'; reg.aplicarBusqueda();
    Check('KF6 con busqueda tambien la nombra', 'No hay iniciativas que coincidan con «zzz», el indicador «Cerradas» y los filtros seleccionados.',
      p.sel('regVacioTexto').textContent);
    p.sel('regBuscar').value = ''; reg.aplicarBusqueda();
    clicIndicador(p, 'cerradas');
    Check('KF6 quitarlo deja el Estado elegido', [['REQ 2026-000004', 'MAP 2026-000002', 'PRB 2026-000005'], ['En Análisis']],
      [folios(p), reg.filtro.estadosMarcados()]);
    sinOmision(p);

    // Semaforo.
    var sem0 = semaforoTexto(p);
    clicIndicador(p, 'sem_atrasada');
    Check('KF7 semaforo Atrasadas: su regla (no la de la tarjeta), marcado, cifras iguales',
      [['PRB 2026-000001', 'REQ 2026-000004', 'PRB 2026-000005'], ['sem_atrasada'], sem0, cifras, '3 de 5 iniciativas · indicador: Semáforo: Atrasadas'],
      [folios(p), pulsados(p), semaforoTexto(p), kpis(p), p.sel('regCuenta').textContent]);
    Check('KF7 boton con clase de marcado', true,
      /<button type="button" class="ini-semaforo-op sel" data-semaforo="atrasada" data-indicador="sem_atrasada" aria-pressed="true"/.test(p.sel('regSemaforo').innerHTML));
    clicIndicador(p, 'sem_en_tiempo');
    Check('KF7 En tiempo reemplaza; la tarjeta no queda marcada', [['MAP 2026-000002'], ['sem_en_tiempo']], [folios(p), pulsados(p)]);
    clicIndicador(p, 'sem_en_tiempo');
    clicIndicador(p, 'sem_sin_fecha');
    Check('KF7 Sin fecha sin ninguna: vacia y lo dice', [[], 'No hay iniciativas que coincidan con el indicador «Semáforo: Sin fecha».'],
      [folios(p), p.sel('regVacioTexto').textContent]);
    clicIndicador(p, 'sem_sin_fecha');

    // Relectura: conserva el indicador, actualiza las cifras.
    clicIndicador(p, 'cerradas');
    elegir(p, 'regDirector', 'Dir B');
    var json = JSON.parse(JSON.stringify(DATOS));
    json.iniciativas[3].estado = 'Cerrado'; json.iniciativas[3].activa = false;   // REQ 4 se cierra
    return reg.actualizar(ok(json));
  }).then(function (r) {
    Check('KF8 relectura: el indicador, el Director y la marca siguen; las cifras se actualizan',
      [true, 'cerradas', 'Dir B', ['cerradas'], ['3', '3', '0', '1', '2'], ['REQ 2026-000004', 'HAR 2025-000003']],
      [r.ok, reg.filtro.indicador, reg.filtro.director, pulsados(p), kpis(p), folios(p)]);
    sinOmision(p);
    // Desde la Cobertura un clic vuelve a la lista; alli no cuenta.
    reg.verCobertura(nunca);
    clicIndicador(p, 'activas');
    Check('KF9 desde la Cobertura vuelve a la lista con el filtro', ['registro', false, ['activas']],
      [reg.modo, p.sel('regListaBloque').hidden, pulsados(p)]);
    reg.verCobertura(nunca);
    Check('KF9 en la Cobertura el indicador no cuenta como filtro', '', p.sel('regFiltrosCuenta').textContent);
    reg.verRegistro();
    clicIndicador(p, 'activas');
    // La tarjeta que filtra vive en assets/css/kpi.css (compartida con las
    // demas pestañas); Criterio y el semaforo siguen en iniciativas.css.
    var css = leer('admin/iniciativas.css'), kpiCss = leer('assets/css/kpi.css');
    Check('KF10 CSS: boton que cubre la tarjeta, Criterio encima, foco visible, marca sin mover la franja',
      [true, true, true, true, true, false],
      [/\.kpi-filtro \{[^}]*position: absolute; inset: 0; z-index: 1;/.test(kpiCss),
       /\.ini-kpi-ayuda \{[^}]*z-index: 2;/.test(css),
       /\.kpi-filtrable:has\(> \.kpi-filtro:focus-visible\) \{ outline: 2px solid var\(--accent/.test(kpiCss),
       /\.kpi\.kpi-sel \{[^}]*border-top-color: var\(--accent/.test(kpiCss) && !/\.kpi\.kpi-sel \{[^}]*border-left/.test(kpiCss),
       /\.ini-semaforo-op:focus-visible \{/.test(css),
       /ini-kpi-filtr|ini-kpi-sel/.test(css)]);
    // La tarjeta la arma SeleccionKpi (clases + boton), la misma plantilla
    // de las demas pestañas: sin copia a mano del boton ni de las clases.
    var regJs = leer('admin/registro-iniciativas.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    Check('KF11 tarjetas con SeleccionKpi.boton/clases, sin plantilla propia',
      [true, true, false, false],
      [/seleccion\.boton\(c\.k, c\.l \+ ': ' \+ fmt\(c\.v\), c\.t\)/.test(regJs),
       /seleccion\.clases\(c\.k\)/.test(regJs),
       /class="kpi-filtro"/.test(regJs),
       /' kpi-filtrable'|' kpi-sel'/.test(regJs)]);
  });
});

// ---------------------------------------------------------------------------
// XD) "⬇ Descargar iniciativas": el .xlsx de lo filtrado, completo
// ---------------------------------------------------------------------------
// El libro se arma con el vendor REAL (experiencia/vendor/xlsx.mini.min.js)
// y se vuelve a abrir con el mismo vendor para leer lo que quedo escrito.
var XLSXV = require(path.join(raiz, 'experiencia', 'vendor', 'xlsx.mini.min.js'));
// Respuesta de admin_iniciativas_registro.ashx?export=1 (RegistroExportExtra):
// columnas de dbo.Problem / dbo.ProblemCategoria que el registro no trae.
// Incluye filas que NO deben aparecer: un folio que no esta en el registro,
// una ruta de PRB 1 que el registro no tiene y un folio repetido.
var EXTRA = {
  iniciativas: [
    { folio: 'PRB 2026-000001', gerencia: 'Ger 1', direccion: 'Dirección Ops', tipo_iniciativa: 'Problem',
      prioridad: 'Alta', impacto: 'Alto', rca: 'Sí', volumetria_original: 1200, f_entrega_prb: '2026-01-15' },
    { folio: 'PRB 2026-000001', gerencia: 'REPETIDO' },
    { folio: 'PRB 2026-000005', gerencia: 'Ger 5', direccion: null, tipo_iniciativa: 'Problem',
      prioridad: 'Media', impacto: null, rca: 'No', volumetria_original: null, f_entrega_prb: null },
    { folio: 'XXX 2026-999999', gerencia: 'Huerfana' }
  ],
  categorias: [
    { folio: 'PRB 2026-000001', categoria: '/A/Cat 1/Hoja', tipo_ticket: 'Incidente', tipo_iniciativa: 'Problem', mes_reduccion: 3 },
    { folio: 'PRB 2026-000001', categoria: '/A/Cat 3', tipo_ticket: 'Requerimiento', tipo_iniciativa: 'Mejora', mes_reduccion: null },
    { folio: 'PRB 2026-000001', categoria: '/A/Otra', tipo_ticket: 'Incidente', tipo_iniciativa: 'Problem', mes_reduccion: 1 },
    { folio: 'XXX 2026-999999', categoria: '/Z', tipo_ticket: 'Incidente', tipo_iniciativa: 'Problem', mes_reduccion: 1 }
  ]
};
// Descarga de prueba: guarda bytes y nombre; cuenta descargas, cargas y
// peticiones de ?export=1 (b.pedir, con b.extra como respuesta).
function Bajada() {
  var b = { veces: 0, bytes: null, nombre: null, cargas: 0, pedidos: [], extra: Respuesta(200, EXTRA) };
  b.pedir = function (url) { b.pedidos.push(url); return Promise.resolve(b.extra); };
  b.cargar = function () { b.cargas++; return Promise.resolve(XLSXV); };
  b.bajar = function (bytes, nombre) { b.veces++; b.bytes = bytes; b.nombre = nombre; };
  b.libro = function () { return XLSXV.read(new Uint8Array(b.bytes), { type: 'array' }); };
  b.hoja = function (nombre) { return XLSXV.utils.sheet_to_json(b.libro().Sheets[nombre], { defval: null }); };
  b.parte = function (ruta) {
    var zip = XLSXV.CFB.read(new Uint8Array(b.bytes), { type: 'array' });
    var e = XLSXV.CFB.find(zip, ruta);
    return e ? Buffer.from(e.content).toString('utf8') : null;
  };
  return b;
}
var HOY = new Date(2026, 9, 22);
// `pedir` que cuenta: la descarga no debe pedir nada al servidor.
function Contador(json) {
  var c = { n: 0 };
  c.pedir = function () { c.n++; return Promise.resolve(Respuesta(200, json)); };
  return c;
}
function columna(filas, k) { return filas.map(function (f) { return f[k]; }); }

pruebas.push(function () {
  var cont = Contador(DATOS);
  var p = Pagina(cont.pedir), reg = p.registro, b = Bajada();
  return esperar().then(function () {
    Check('XD1 boton habilitado con el registro cargado (ADM)', false, p.sel('regDescargar').disabled);
    var antes = cont.n;
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir).then(function (r) {
      Check('XD2 descarga hecha: sin releer el registro, UNA peticion ?export=1', [true, 1, 0, ['../handlers/admin_iniciativas_registro.ashx?export=1']],
        [r, b.veces, cont.n - antes, b.pedidos]);
      Check('XD2 nombre con la fecha, sin filtro', 'Iniciativas_2026-10-22.xlsx', b.nombre);
      var libro = b.libro();
      Check('XD3 .xlsx real (zip PK) con dos hojas', [80, 75, ['Iniciativas', 'Categorías']],
        [b.bytes[0], b.bytes[1], libro.SheetNames]);
      var ini = b.hoja('Iniciativas'), cat = b.hoja('Categorías');
      Check('XD3 encabezados de Iniciativas',
        ['Código', 'Tipo de iniciativa', 'Título', 'Título del problema', 'Estado', 'Subestado', 'Agrupación',
         'Tipo Iniciativa (Problem)', 'Medible', 'Prioridad', 'Impacto',
         'Product Owner', 'Service Owner', 'Director', 'Gerencia', 'Dirección', 'RCA', 'Fecha de creación',
         'Fecha entrega PRB', 'Antigüedad (días)', 'Fecha análisis',
         'Fecha solución', 'Fecha cierre', 'Fecha compromiso vigente', 'Semáforo', 'Categorías', 'Volumetría original',
         'Tickets a reducir', 'Tickets en riesgo', 'Descripción', 'Observaciones'],
        XLSXV.utils.sheet_to_json(libro.Sheets.Iniciativas, { header: 1 })[0]);
      Check('XD3 encabezados de Categorías',
        ['Código', 'Título', 'Estado de la iniciativa', 'Categoría', 'Categoría N2', 'Agrupación', 'Tipo de ticket',
         'Tipo Iniciativa (categoría)', '% disminución', 'Tickets a reducir', 'Mes reducción', 'Fecha análisis',
         'Director', 'Product Owner', 'Service Owner'],
        XLSXV.utils.sheet_to_json(libro.Sheets['Categorías'], { header: 1 })[0]);
      Check('XD4 una fila por iniciativa, en el orden de la tabla (la entrada sin folio no sale)',
        folios(p), columna(ini, 'Código'));
      Check('XD5 PRB 1 con sus dos categorias; las demas con una',
        ['PRB 2026-000001', 'PRB 2026-000001', 'REQ 2026-000004', 'MAP 2026-000002', 'HAR 2025-000003'], columna(cat, 'Código'));
      Check('XD5 rutas y % de PRB 1 (fraccion con formato %)', [['/A/Cat 1/Hoja', 0.5], ['/A/Cat 3', 0.25]],
        cat.slice(0, 2).map(function (f) { return [f['Categoría'], f['% disminución']]; }));
      Check('XD5 dueños de cada categoria (no los capturados)', ['PO 1', 'PO 2'], columna(cat.slice(0, 2), 'Product Owner'));
      var sin = ini.filter(function (f) { return f['Código'] === 'PRB 2026-000005'; })[0];
      Check('XD6 sin categoria: en Iniciativas con 0 categorias, ninguna fila inventada en Categorías',
        [true, 0, false], [!!sin, sin && sin['Categorías'], columna(cat, 'Código').indexOf('PRB 2026-000005') >= 0]);
      var prb1 = ini[0];
      Check('XD7 Tickets a reducir / en riesgo = los del servidor (150), una vez', [150, 150],
        [prb1['Tickets a reducir'], prb1['Tickets en riesgo']]);
      var sumaIni = columna(ini, 'Tickets a reducir').reduce(function (a, v) { return a + v; }, 0);
      var sumaCat = columna(cat, 'Tickets a reducir').reduce(function (a, v) { return a + v; }, 0);
      Check('XD7 total de Iniciativas = total de Categorías = registro (225)', [225, 225], [sumaIni, sumaCat]);
      Check('XD8 datos de la iniciativa', ['Problem', 'PO 1', 'SO x', 'Dir A', 'Sí', 'Atrasada', 'Desc PRB 2026-000001'],
        [prb1['Tipo de iniciativa'], prb1['Product Owner'], prb1['Service Owner'], prb1.Director, prb1.Medible,
         prb1['Semáforo'], prb1['Descripción']]);
      var har = ini.filter(function (f) { return f['Código'] === 'HAR 2025-000003'; })[0];
      Check('XD8 no activa: sin fecha compromiso vigente ni semaforo', [null, null, 'No'],
        [har['Fecha compromiso vigente'], har['Semáforo'], har.Medible]);
      // Fechas como fecha real de Excel: numero de serie (R = Fecha de creacion).
      var celda = libro.Sheets.Iniciativas.R2;
      Check('XD8 fecha de creacion: serie 46032 (2026-01-10)', ['n', 46032], [celda.t, celda.v]);
      var estilos = b.parte('/xl/styles.xml'), h1 = b.parte('/xl/worksheets/sheet1.xml'), h2 = b.parte('/xl/worksheets/sheet2.xml');
      Check('XD3 formato: estilos propios, encabezado congelado y autofiltro en las dos hojas',
        [true, true, true, true, true, true],
        [/formatCode="dd\/mm\/yyyy"/.test(estilos), /formatCode="0\.0%"/.test(estilos),
         /<pane ySplit="1"[^>]*state="frozen"/.test(h1), /<pane ySplit="1"[^>]*state="frozen"/.test(h2),
         /<autoFilter ref="A1:AE6"/.test(h1), /<autoFilter ref="A1:O6"/.test(h2)]);
    });
  });
});

pruebas.push(function () {
  var cont = Contador(DATOS);
  var p = Pagina(cont.pedir), reg = p.registro, b = Bajada();
  function foto() {
    return { folios: folios(p), orden: JSON.stringify(reg.orden), limite: reg.limite, abierta: reg.abierta,
      dir: p.sel('regDirector').value, cuenta: p.sel('regCuenta').textContent, filtros: p.sel('regFiltrosCuenta').textContent };
  }
  var antes;
  return esperar().then(function () {
    // Filtro, orden y detalle abierto: la descarga los respeta y no los toca.
    elegir(p, 'regDirector', 'Dir A');
    reg.ordenarPor('folio');
    reg.ordenarPor('folio');                 // desc
    reg.abrirDetalle('MAP 2026-000002');
    antes = foto();
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function () {
    Check('XD9 filtro Director: solo sus iniciativas, en el orden de la tabla (desc)',
      ['PRB 2026-000001', 'MAP 2026-000002'], columna(b.hoja('Iniciativas'), 'Código'));
    Check('XD9 categorias solo de esas iniciativas', ['PRB 2026-000001', 'PRB 2026-000001', 'MAP 2026-000002'],
      columna(b.hoja('Categorías'), 'Código'));
    Check('XD9 nombre marcado como filtrado', 'Iniciativas_2026-10-22_filtrado.xlsx', b.nombre);
    Check('XD10 la vista queda igual: filtros, orden, pagina, detalle abierto', antes, foto());
    // Busqueda.
    elegir(p, 'regDirector', '');
    p.sel('regBuscar').value = 'REQ'; reg.aplicarBusqueda();
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function () {
    Check('XD9 busqueda REQ', ['REQ 2026-000004'], columna(b.hoja('Iniciativas'), 'Código'));
    p.sel('regBuscar').value = ''; reg.aplicarBusqueda();
    clicIndicador(p, 'cerradas');
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function () {
    Check('XD9 indicador Cerradas', ['HAR 2025-000003'], columna(b.hoja('Iniciativas'), 'Código'));
    clicIndicador(p, 'cerradas');
    // Vacio: nada que bajar, aviso, boton deshabilitado.
    p.sel('regBuscar').value = 'no-existe-zzz'; reg.aplicarBusqueda();
    Check('XD11 sin resultados: boton deshabilitado', true, p.sel('regDescargar').disabled);
    var veces = b.veces;
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir).then(function (r) {
      Check('XD11 sin resultados: no baja nada y lo dice', [false, veces, false, true],
        [r, b.veces, p.sel('regDescargaMsg').hidden, /nada que descargar/.test(p.sel('regDescargaMsg').textContent)]);
      Check('XD12 ninguna descarga pidio nada al servidor (solo la carga)', 1, cont.n);
    });
  });
});

pruebas.push(function () {
  // 250 iniciativas: la tabla pinta 100 (PAGINA) y el libro lleva las 250.
  var muchas = [];
  for (var n = 1; n <= 250; n++) {
    muchas.push(Ini('PRB 2026-' + ('00000' + n).slice(-6), { prefijo: 'PRB', f_creacion: '2026-01-01', tickets_reduce: 2,
      categorias: [Cat('/A/X' + n, 1, 0.1, 'Dir A', 'PO 1', 'SO x'), Cat('/A/Y' + n, 1, 0.1, 'Dir A', 'PO 1', 'SO x')] }));
  }
  var datos = JSON.parse(JSON.stringify(DATOS));
  datos.iniciativas = muchas;
  var p = Pagina(ok(datos)), reg = p.registro, b = Bajada();
  p.sel('regDescargar').textContent = '⬇ Descargar iniciativas';
  return esperar().then(function () {
    Check('XD13 la tabla muestra una pagina', [100, false], [folios(p).length, p.sel('regMas').hidden]);
    // Doble clic: un solo libro.
    var uno = reg.descargar(b.cargar, b.bajar, HOY, b.pedir), dos = reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
    Check('XD14 mientras prepara: boton deshabilitado y rotulo', [true, 'Preparando…'],
      [p.sel('regDescargar').disabled, p.sel('regDescargar').textContent]);
    return Promise.all([uno, dos]).then(function (r) {
      Check('XD14 doble clic = una descarga', [[true, false], 1, 1], [r, b.veces, b.cargas]);
      var codigos = columna(b.hoja('Iniciativas'), 'Código');
      Check('XD13 el libro lleva las 250, cada una una vez, y sus 500 categorias', [250, 250, 500],
        [codigos.length, Object.keys(codigos.reduce(function (o, k) { o[k] = 1; return o; }, {})).length,
         b.hoja('Categorías').length]);
      Check('XD14 al terminar: rotulo y boton de vuelta; pagina intacta', ['⬇ Descargar iniciativas', false, 100],
        [p.sel('regDescargar').textContent, p.sel('regDescargar').disabled, folios(p).length]);
    });
  });
});

pruebas.push(function () {
  // Error al cargar SheetJS: aviso, sin descarga, boton listo para reintentar.
  var p = Pagina(ok(DATOS), null, 'MOD'), reg = p.registro, b = Bajada();
  return esperar().then(function () {
    Check('XD15 MOD tambien ve el boton habilitado', false, p.sel('regDescargar').disabled);
    return reg.descargar(function () { return Promise.reject(new Error('no se pudo cargar x.js')); }, b.bajar, HOY, b.pedir);
  }).then(function (r) {
    Check('XD15 fallo: aviso visible, sin descarga, boton habilitado de nuevo',
      [false, 0, false, 'No se pudo descargar el Excel: no se pudo cargar x.js', false],
      [r, b.veces, p.sel('regDescargaMsg').hidden, p.sel('regDescargaMsg').textContent, p.sel('regDescargar').disabled]);
  });
});

pruebas.push(function () {
  // Sin ningun filtro: aviso antes de bajar el registro completo.
  var p = Pagina(ok(DATOS)), reg = p.registro, b = Bajada();
  var preguntas = [], respuesta = false;
  reg.confirmar = function (m) { preguntas.push(m); return respuesta; };
  return esperar().then(function () {
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function (r) {
    Check('XD17 sin filtros: pregunta con la cifra', ['No hay filtros aplicados: se descargarán las 5 iniciativas del registro completo. ¿Continuar?'], preguntas);
    Check('XD17 cancelar: no carga ni baja nada, sin mensaje, boton habilitado', [false, 0, 0, true, false],
      [r, b.cargas, b.veces, p.sel('regDescargaMsg').hidden, p.sel('regDescargar').disabled]);
    respuesta = true;
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function (r) {
    Check('XD17 aceptar: baja las 5', [true, 1, 5], [r, b.veces, b.hoja('Iniciativas').length]);
    preguntas = [];
    elegir(p, 'regDirector', 'Dir A');
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function () {
    Check('XD17 con un filtro no pregunta', [[], 2], [preguntas, b.veces]);
    elegir(p, 'regDirector', '');
    p.sel('regBuscar').value = 'PRB'; reg.aplicarBusqueda();
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function () {
    Check('XD17 la busqueda cuenta como filtro: no pregunta', [[], 3], [preguntas, b.veces]);
  });
});

pruebas.push(function () {
  // Solo lectura y sin endpoint nuevo: el codigo de la descarga no hace
  // fetch ni POST, y el unico origen sigue siendo el handler con ADM/MOD.
  var libro = leer('admin/libro-iniciativas.js');
  var reg = leer('admin/registro-iniciativas.js');
  var desc = reg.slice(reg.indexOf('    descargar(cargar, bajar, hoy, pedir) {'), reg.indexOf('    textoVacio() {'));
  var exp = reg.slice(reg.indexOf('  var ExportRegistro = {'), reg.indexOf('  // SheetJS: el MISMO vendor'));
  // La unica peticion de la descarga: GET (fetch sin method ni body) a
  // URL_EXPORT, el mismo handler del registro con ?export=1.
  var llamadas = desc.match(/fetch\([^)]*\)/g) || [];
  Check('XD16 la descarga solo lee: un GET a URL_EXPORT, nada mas', [true, true, false, ["fetch(url, { cache: 'no-store' })"], true, false, false, false],
    [desc.length > 0, exp.length > 0, /fetch|XMLHttpRequest|\.ashx/.test(libro), llamadas, /URL_EXPORT\)/.test(desc),
     /POST|method|body:|\.ashx/.test(desc), /fetch|\.ashx|POST/.test(exp), /export=1/.test(desc)]);
  Check('XD16 URL_EXPORT = el handler del registro con ?export=1', true,
    /var URL_EXPORT = URL_REGISTRO \+ '\?export=1';/.test(reg));
  // El registro (y su descarga) es de toda cuenta autenticada (2026-10-28):
  // AccesoIniciativas.ExigirRegistro antes de leer nada.
  Check('XD16 el registro exige una cuenta autenticada antes de leer', true,
    /if \(!AccesoIniciativas\.ExigirRegistro\(context\)\) return;/.test(leer('handlers/admin_iniciativas_registro.ashx')));
  var ashx = leer('handlers/admin_iniciativas_registro.ashx');
  Check('XD16 ?export=1 va DESPUES de ExigirRegistro y solo acepta 1', [true, true, true],
    [ashx.indexOf('if (!AccesoIniciativas.ExigirRegistro(context)) return;') >= 0 &&
       ashx.indexOf('if (!AccesoIniciativas.ExigirRegistro(context)) return;') < ashx.indexOf('QueryString["export"]'),
     /if \(export != "1"\)\s*\{\s*context\.Response\.StatusCode = 400;/.test(ashx),
     /RegistroExportExtra\(\)/.test(ashx)]);
  var cs = leer('App_Code/ExperienciaRegistro.cs');
  var sqlExtra = cs.slice(cs.indexOf('SQL_EXPORT_EXTRA ='), cs.indexOf('public static Dictionary<string, object> RegistroExportExtra()'));
  Check('XD16 SQL de ?export=1: dos SELECT de vigentes, sin escribir ni parametros', [true, 2, false, false],
    [sqlExtra.length > 0, (sqlExtra.match(/SELECT /g) || []).length,
     /\b(INSERT|UPDATE|DELETE|MERGE|EXEC|DROP|ALTER|CREATE|TRUNCATE)\b/i.test(sqlExtra), /@/.test(sqlExtra)]);
  Check('XD16 ningun handler nuevo de exportacion de iniciativas', [], fs.readdirSync(path.join(raiz, 'handlers'))
    .filter(function (h) { return /iniciativas.*export|export.*iniciativas/i.test(h); }));
  Check('XD16 libro-iniciativas.js antes de registro-iniciativas.js', true,
    /libro-iniciativas\.js"><\/script>\s*<script src="registro-iniciativas\.js/.test(leer('admin/iniciativas.html')));
  return Promise.resolve();
});

// ---------------------------------------------------------------------------
// XE) Columnas de ?export=1: en su hoja, cruzadas por folio / ruta, sin
// filas nuevas; la carga normal del registro no las pide; fallos sin Excel.
// ---------------------------------------------------------------------------
pruebas.push(function () {
  var urls = [];
  var p = Pagina(function (url) { urls.push(url); return Promise.resolve(Respuesta(200, DATOS)); }), reg = p.registro, b = Bajada();
  return esperar().then(function () {
    Check('XE1 cargar el registro NO pide ?export=1', [['../handlers/admin_iniciativas_registro.ashx'], []],
      [urls, b.pedidos]);
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function () {
    var ini = b.hoja('Iniciativas'), cat = b.hoja('Categorías');
    function de(folio) { return ini.filter(function (f) { return f['Código'] === folio; })[0]; }
    var prb1 = de('PRB 2026-000001'), prb5 = de('PRB 2026-000005'), har = de('HAR 2025-000003');
    var CAMPOS = ['Gerencia', 'Dirección', 'Tipo Iniciativa (Problem)', 'Prioridad', 'Impacto', 'RCA', 'Volumetría original'];
    function campos(f) { return CAMPOS.map(function (k) { return f[k]; }); }
    Check('XE2 Iniciativas: columnas de dbo.Problem de PRB 1 (la primera fila del folio, no la repetida)',
      ['Ger 1', 'Dirección Ops', 'Problem', 'Alta', 'Alto', 'Sí', 1200], campos(prb1));
    Check('XE2 Fecha entrega PRB como fecha real (2026-01-15 = 46037)', ['n', 46037], [b.libro().Sheets.Iniciativas.S2.t, b.libro().Sheets.Iniciativas.S2.v]);
    Check('XE3 sin categoria: sus columnas de Problem si llegan; nulos vacios, sin 0', ['Ger 5', null, 'Problem', 'Media', null, 'No', null],
      campos(prb5));
    Check('XE3 iniciativa sin fila en ?export=1: columnas vacias, la fila sigue', [null, null, null, null, null, null, null],
      campos(har));
    Check('XE4 Iniciativas: mismas filas y una por codigo; la huerfana de ?export=1 no entra', [5, 5, false],
      [ini.length, Object.keys(columna(ini, 'Código').reduce(function (o, k) { o[k] = 1; return o; }, {})).length,
       columna(ini, 'Código').indexOf('XXX 2026-999999') >= 0]);
    Check('XE5 Categorías: TipoTicket / TipoIniciativa / MesReduccion por (folio, ruta)',
      [['/A/Cat 1/Hoja', 'Incidente', 'Problem', 3], ['/A/Cat 3', 'Requerimiento', 'Mejora', null]],
      cat.slice(0, 2).map(function (f) { return [f['Categoría'], f['Tipo de ticket'], f['Tipo Iniciativa (categoría)'], f['Mes reducción']]; }));
    Check('XE5 Categorías: las mismas 5 filas reales; /A/Otra y la huerfana no se agregan', [5, false, false],
      [cat.length, columna(cat, 'Categoría').indexOf('/A/Otra') >= 0, columna(cat, 'Código').indexOf('XXX 2026-999999') >= 0]);
    Check('XE5 categoria sin fila en ?export=1: vacias', [null, null, null],
      (function (f) { return [f['Tipo de ticket'], f['Tipo Iniciativa (categoría)'], f['Mes reducción']]; })(
        cat.filter(function (f) { return f['Código'] === 'MAP 2026-000002'; })[0]));
    Check('XE6 sin categoria: ninguna fila en Categorías', false, columna(cat, 'Código').indexOf('PRB 2026-000005') >= 0);
    Check('XE6 columnas de antes intactas', [150, 'PO 1', 'Atrasada', 0.5],
      [ini[0]['Tickets a reducir'], ini[0]['Product Owner'], ini[0]['Semáforo'], cat[0]['% disminución']]);
    // Filtro: lo extra no cambia que filas salen.
    elegir(p, 'regDirector', 'Dir B');
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir);
  }).then(function () {
    Check('XE7 con filtro Director: solo sus iniciativas, aunque ?export=1 traiga todas',
      ['REQ 2026-000004', 'PRB 2026-000005', 'HAR 2025-000003'], columna(b.hoja('Iniciativas'), 'Código'));
    Check('XE7 una peticion ?export=1 por descarga (no una por iniciativa)', 2, b.pedidos.length);
  });
});

pruebas.push(function () {
  // Fallos de ?export=1: no hay Excel, el mensaje lo dice, el boton vuelve.
  var p = Pagina(ok(DATOS)), reg = p.registro, b = Bajada();
  function intento(respuesta, caso, texto) {
    b.extra = respuesta;
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir).then(function (r) {
      Check(caso, [false, 0, false, texto, false],
        [r, b.veces, p.sel('regDescargaMsg').hidden, p.sel('regDescargaMsg').textContent, p.sel('regDescargar').disabled]);
    });
  }
  return esperar().then(function () {
    return intento(Respuesta(500, { error: 'Fallo la consulta.', tipo: 'SqlException' }),
      'XE8 500 del servidor: sin Excel, su mensaje', 'No se pudo descargar el Excel: Fallo la consulta.');
  }).then(function () {
    return intento(Respuesta(403, { error: 'Acceso denegado.' }),
      'XE8 403 (sin ADM/MOD): sin Excel', 'No se pudo descargar el Excel: Acceso denegado.');
  }).then(function () {
    return intento(Respuesta(200, { iniciativas: [] }),
      'XE8 respuesta sin categorias: sin Excel a medias', 'No se pudo descargar el Excel: la respuesta del servidor no trae las columnas del Excel.');
  }).then(function () {
    b.pedir = function () { return Promise.reject(new TypeError('Failed to fetch')); };
    return reg.descargar(b.cargar, b.bajar, HOY, b.pedir).then(function (r) {
      Check('XE8 red caida: sin Excel', [false, 0, 'No se pudo descargar el Excel: No se pudo conectar con el servidor.'],
        [r, b.veces, p.sel('regDescargaMsg').textContent]);
      // Sin resultados no se pide nada.
      var pedidos = 0;
      p.sel('regBuscar').value = 'no-existe-zzz'; reg.aplicarBusqueda();
      return reg.descargar(b.cargar, b.bajar, HOY, function () { pedidos++; return Promise.resolve(Respuesta(200, EXTRA)); })
        .then(function (r2) { Check('XE9 sin resultados: ni peticion ni Excel', [false, 0], [r2, pedidos]); });
    });
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
