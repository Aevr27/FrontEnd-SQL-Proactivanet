/* =========================================================================
   efectividad/efectividad.js

   Pestaña "Efectividad de iniciativas". Un solo archivo para la pagina
   suelta (efectividad/efectividad.html) y para la pestaña del tablero, que
   monta ese mismo marcado e inyecta este mismo script (TableroEfectividad
   en dashboard.js).

   De donde sale cada cosa: handlers/efectividad.ashx, que lee lo que deja
   el 60 (dbo.ExpEfectividad y dbo.ExpEfectividadCorrida) y las categorias
   con sus dueños tal como las arma Experiencia. Aqui NO se recalcula la
   efectividad de ninguna fila: solo se filtra, se suma y se pinta.

   Dos partes:
     1. EfectividadCalc: las cuentas, sin DOM. Las usa la pestaña y las
        prueba node (tools/tests/EfectividadPestanaSmoke.js), que tambien
        revisa que con los mismos filtros den lo mismo que la tarjeta
        "% Efectividad Reducción" de Experiencia (efectividadDe).
     2. La pestaña: filtros, tarjetas, las tres vistas, la boleta y el Excel
        (SheetJS, efectividad/vendor/xlsx.mini.min.js, cargado al pulsar).
   ========================================================================= */

(function (fabrica) {
  var calc = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = calc;
  if (typeof window !== 'undefined') window.EfectividadCalc = calc;
})(function () {
  'use strict';

  // Los codigos de Orden del 60 (y del bloque 1a del 41).
  var MEDIDA = 15, MEDICION = 14;

  // Efectiva = logro de 90% o mas de lo prometido: @Umbral del 60, con el
  // que cuenta IniciativasEfectivas.
  var UMBRAL = 0.9;

  // Las que no se pueden calificar, en tres grupos segun quien las arregla.
  var GRUPOS = [
    { id: 'corregir', titulo: 'Corregir en el Excel',
      nota: 'Les falta un dato o lo traen mal. Se arreglan en el Excel de iniciativas y entran en la siguiente carga.',
      ordenes: [3, 5, 6, 7, 8, 9] },
    { id: 'historia', titulo: 'Sin historia suficiente',
      nota: 'Su categoría no tenía tickets (o tenía menos de 30 días de historial) antes de crearse la iniciativa: no hay contra qué comparar.',
      ordenes: [12, 13] },
    { id: 'regla', titulo: 'No entran por regla',
      nota: 'No se califican a propósito: aún no se implementan, se cancelaron, no llevan control de fecha (RTI/REQ), cerraron hace más de 12 meses o sus tickets no los cuenta el tablero.',
      ordenes: [1, 2, 4, 10, 11] },
  ];

  function grupoDe(orden) {
    for (var i = 0; i < GRUPOS.length; i++)
      if (GRUPOS[i].ordenes.indexOf(orden) >= 0) return GRUPOS[i].id;
    return null;
  }

  // El semaforo de las tarjetas de Experiencia (SEM): 90% verde, 70% ambar.
  function sem(v) { return v >= 0.9 ? 'v' : (v >= 0.7 ? 'a' : 'r'); }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }

  // ---- El filtro: el mismo de la tarjeta de Experiencia ------------------
  //
  // pasaFiltroGlobal: los cuatro dueños por AND; un filtro vacio no
  // restringe. detReal: las categorias que pasan, C2 + los C1 sin ningun C2
  // que haya pasado. Una fila pasa si su C1&C2 o su C1 es una de ellas
  // (efectividadDe en experiencia.js). Sin filtros de dueño pasan todas.
  // El tipo (prefijo del folio) es un filtro mas, encima.
  function pasaDuenos(o, f) {
    if (f.dir && o.director !== f.dir) return false;
    if (f.po && o.po !== f.po) return false;
    if (f.mgr && o.manager !== f.mgr) return false;
    if (f.so && o.so !== f.so) return false;
    return true;
  }

  function hayFiltroDuenos(f) { return !!(f && (f.dir || f.po || f.mgr || f.so)); }

  function nodosDeLosDuenos(categorias, f) {
    var cats = (categorias || []).filter(function (c) { return pasaDuenos(c, f); });
    var c1conHijos = new Set(cats.filter(function (c) { return c.nivel === 'C2'; })
      .map(function (c) { return String(c.categoria).split('/')[1]; }));
    var nodos = new Set();
    cats.forEach(function (c) {
      if (c.nivel === 'C2' || !c1conHijos.has(c.categoria)) nodos.add(c.categoria);
    });
    return nodos;
  }

  function filtrar(datos, f) {
    f = f || {};
    var filas = (datos && datos.filas) || [];
    var nodos = hayFiltroDuenos(f) ? nodosDeLosDuenos(datos.categorias, f) : null;
    return filas.filter(function (r) {
      if (f.tipo && r.prefijo !== f.tipo) return false;
      if (nodos && !nodos.has(r.c1c2) && !nodos.has(r.c1)) return false;
      return true;
    });
  }

  // ---- Por iniciativa -----------------------------------------------------

  function califica(comp, logro) {
    if (!(comp > 0)) return { ef: null, cal: 'sin_comp' };
    var ef = logro / comp;
    return { ef: ef, cal: ef >= UMBRAL ? 'efectiva' : (ef > 0 ? 'parcial' : 'sin_baja') };
  }

  // Una entrada por folio con sus filas de un Orden (las medidas o las en
  // medicion), en el orden en que llegan.
  function agrupar(filas, orden) {
    var porFolio = new Map();
    filas.forEach(function (r) {
      if (r.orden !== orden) return;
      var i = porFolio.get(r.folio);
      if (!i) {
        i = { folio: r.folio, titulo: r.titulo || null, prefijo: r.prefijo, estado: r.estado,
              agrup: r.agrup || null, creacion: r.creacion, cierre: r.cierre, se_mide_desde: r.se_mide_desde,
              comp: 0, logro: 0, asignada: 0, evitados: 0, reduccion_hoy: 0, evalua_rebote: false, filas: [] };
        porFolio.set(r.folio, i);
      }
      if (!i.titulo && r.titulo) i.titulo = r.titulo;
      i.comp += num(r.comp);
      i.logro += num(r.logro);
      i.asignada += num(r.asignada);
      i.evitados += num(r.evitados);
      i.reduccion_hoy += num(r.reduccion_hoy);
      if (r.evalua_rebote) i.evalua_rebote = true;
      if (r.se_mide_desde && (!i.se_mide_desde || r.se_mide_desde < i.se_mide_desde)) i.se_mide_desde = r.se_mide_desde;
      i.filas.push(r);
    });
    return Array.from(porFolio.values());
  }

  // Las medidas, con su calificacion. Rebote como el 60: ya pasaron 180 dias
  // del cierre (EvaluaRebote), bajo de verdad (la reduccion repartida es
  // positiva) y hoy ya no esta por debajo de lo esperado.
  function medidas(filas) {
    return agrupar(filas, MEDIDA).map(function (i) {
      var c = califica(i.comp, i.logro);
      i.efectividad = c.ef;
      i.calificacion = c.cal;
      i.empeoro = i.asignada < 0;
      i.evalua_rebote_real = i.evalua_rebote && i.asignada > 0;
      i.rebote = i.evalua_rebote_real && i.reduccion_hoy <= 0;
      return i;
    });
  }

  function enMedicion(filas) {
    return agrupar(filas, MEDICION).sort(function (a, b) {
      return String(a.se_mide_desde || '9999').localeCompare(String(b.se_mide_desde || '9999')) ||
             String(a.folio).localeCompare(String(b.folio));
    });
  }

  // Cuantas iniciativas se pueden calificar en cada mes ('aaaa-mm').
  function calendario(filas) {
    var porMes = new Map();
    enMedicion(filas).forEach(function (i) {
      var m = String(i.se_mide_desde || '').slice(0, 7);
      if (!m) return;
      var e = porMes.get(m) || { mes: m, iniciativas: 0, comp: 0 };
      e.iniciativas++;
      e.comp += i.comp;
      porMes.set(m, e);
    });
    return Array.from(porMes.values()).sort(function (a, b) { return a.mes.localeCompare(b.mes); });
  }

  // Las filas que no se pueden calificar, por grupo y por motivo. Una
  // iniciativa puede salir aqui con una categoria y en Medidas con otra.
  function noCalificables(filas) {
    var salida = GRUPOS.map(function (g) { return { id: g.id, titulo: g.titulo, nota: g.nota, motivos: [], folios: new Set() }; });
    var porId = {};
    salida.forEach(function (g) { porId[g.id] = g; });
    filas.forEach(function (r) {
      if (r.orden === MEDIDA || r.orden === MEDICION) return;
      var g = porId[grupoDe(r.orden)] || porId.regla;
      var m = null;
      for (var k = 0; k < g.motivos.length; k++) if (g.motivos[k].orden === r.orden) m = g.motivos[k];
      if (!m) { m = { orden: r.orden, motivo: r.motivo, filas: [], folios: new Set() }; g.motivos.push(m); }
      m.filas.push(r);
      m.folios.add(r.folio);
      g.folios.add(r.folio);
    });
    salida.forEach(function (g) {
      g.motivos.sort(function (a, b) { return b.folios.size - a.folios.size || a.orden - b.orden; });
    });
    return salida;
  }

  // ---- Las tarjetas ---------------------------------------------------------
  //
  // Sin filtros dan lo mismo que la corrida del 60 (Compromiso, Logro,
  // IniciativasMedidas, IniciativasEfectivas, EvaluablesRebote, ConRebote,
  // TicketsEvitados, IniciativasEnMedicion, PrimeraEnMedirse).
  function resumen(filas) {
    var med = medidas(filas);
    var r = { comp: 0, logro: 0, kpi: null, medidas: med.length,
              efectivas: 0, parciales: 0, sin_baja: 0, sin_comp: 0,
              evitados: 0, evaluables_rebote: 0, con_rebote: 0,
              en_medicion: 0, primera: null, no_calificables: 0, por_corregir: 0 };
    med.forEach(function (i) {
      r.comp += i.comp;
      r.logro += i.logro;
      r.evitados += i.evitados;
      if (i.calificacion === 'efectiva') r.efectivas++;
      else if (i.calificacion === 'parcial') r.parciales++;
      else if (i.calificacion === 'sin_baja') r.sin_baja++;
      else r.sin_comp++;
      if (i.evalua_rebote_real) r.evaluables_rebote++;
      if (i.rebote) r.con_rebote++;
    });
    r.kpi = r.comp > 0 ? r.logro / r.comp : null;
    var enMed = enMedicion(filas);
    r.en_medicion = enMed.length;
    enMed.forEach(function (i) { if (i.se_mide_desde && (!r.primera || i.se_mide_desde < r.primera)) r.primera = i.se_mide_desde; });
    var nc = noCalificables(filas);
    var todos = new Set();
    nc.forEach(function (g) { g.folios.forEach(function (x) { todos.add(x); }); });
    r.no_calificables = todos.size;
    r.por_corregir = nc.filter(function (g) { return g.id === 'corregir'; })[0].folios.size;
    return r;
  }

  // ---- La boleta -------------------------------------------------------------

  // La meta de una categoria: hasta donde tenian que bajar los tickets para
  // lograr todo lo prometido. Logro = (esperado - despues) x parte, topado en
  // el compromiso, asi que la meta es esperado - compromiso / parte.
  function meta(r) {
    if (!(num(r.parte) > 0) || r.esperado_mes == null || r.comp == null) return null;
    return Math.max(0, r.esperado_mes - r.comp / r.parte);
  }

  function tipos(filas) {
    var s = new Set();
    (filas || []).forEach(function (r) { if (r.prefijo) s.add(r.prefijo); });
    return Array.from(s).sort();
  }

  return {
    MEDIDA: MEDIDA, MEDICION: MEDICION, UMBRAL: UMBRAL, GRUPOS: GRUPOS,
    grupoDe: grupoDe, sem: sem, pasaDuenos: pasaDuenos, filtrar: filtrar,
    medidas: medidas, enMedicion: enMedicion, calendario: calendario,
    noCalificables: noCalificables, resumen: resumen, meta: meta, tipos: tipos,
  };
});

(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var PREFIJO = 'ef-';
  function $(id) { return document.getElementById(PREFIJO + id); }
  if (!$('kpis')) return;
  var Calc = window.EfectividadCalc;

  // Rutas resueltas contra este script: embebido, el documento vive un nivel
  // mas arriba. document.currentScript solo vale mientras se evalua.
  var YO = document.currentScript && document.currentScript.src;
  function junto(rel, respaldo) { try { return new URL(rel, YO).href; } catch (e) { return respaldo; } }
  var API = junto('../handlers/efectividad.ashx', 'handlers/efectividad.ashx');
  var XLSX_URL = junto('vendor/xlsx.mini.min.js', 'efectividad/vendor/xlsx.mini.min.js');

  /* ------------------------------------------------------------ formato */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  var NF0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function n0(v) { return v == null ? '—' : NF0.format(v); }
  function n1(v) { return v == null ? '—' : NF1.format(v); }
  function pct(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }
  var MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  function dia(s) {          // 'aaaa-mm-dd' -> 'dd/mm/aaaa'
    var p = String(s || '').split('-');
    return p.length >= 3 ? p[2].slice(0, 2) + '/' + p[1] + '/' + p[0] : '—';
  }
  function diaMes(s) {       // 'aaaa-mm-dd' -> 'dd-mmm'
    var p = String(s || '').split('-');
    return p.length >= 3 ? p[2].slice(0, 2) + '-' + MES[+p[1] - 1] : '—';
  }
  function mesAnio(m) {      // 'aaaa-mm' -> 'oct 2026'
    var p = String(m || '').split('-');
    return p.length >= 2 ? MES[+p[1] - 1] + ' ' + p[0] : m;
  }

  // El icono va en SVG y no como caracter: un medio circulo no viene en todas
  // las fuentes. Siempre con su texto: la calificacion nunca es solo un color.
  var ICONO = {
    efectiva: '<path d="M1.5 5.2 4 7.6 8.5 2.4"/>',
    parcial: '<circle cx="5" cy="5" r="3.7"/><path class="lleno" d="M5 1.3a3.7 3.7 0 0 1 0 7.4z"/>',
    sin_baja: '<path d="M2 2l6 6M8 2 2 8"/>',
    sin_comp: '<path d="M2 5h6"/>',
  };
  var CAL = {
    efectiva: { clase: 'dentro', texto: 'Efectiva' },
    parcial:  { clase: 'medio', texto: 'Parcial' },
    sin_baja: { clase: 'vencido', texto: 'Sin baja' },
    sin_comp: { clase: 'neutro', texto: 'Sin compromiso' },
  };
  function pill(cal) {
    var c = CAL[cal] ? cal : 'sin_comp';
    return '<span class="pill ' + CAL[c].clase + '"><svg class="ef-ico" viewBox="0 0 10 10" aria-hidden="true" focusable="false">' +
      ICONO[c] + '</svg> ' + CAL[c].texto + '</span>';
  }
  function medidor(ef) {
    if (ef == null) return '';
    var v = Math.max(0, Math.min(1, ef));
    return '<span class="ef-medidor ' + (v >= 0.9 ? '' : (v > 0 ? 'a' : 'r')) + '" aria-hidden="true"><i style="width:' +
      Math.round(v * 100) + '%"></i></span>';
  }

  /* ------------------------------------------------------------ estado */
  var datos = null;
  var f = { dir: '', po: '', mgr: '', so: '', tipo: '' };
  var vista = { filas: [], medidas: [], enMedicion: [], sin: [], resumen: null };
  var orden = { col: 'comp', dir: -1 };
  var busqueda = '';

  // Tarjeta elegida con un clic (SeleccionKpi, assets/js/seleccion-kpi.js).
  // Cuatro tarjetas son poblaciones que ya tienen su hoja: Iniciativas
  // medidas, En medicion y No se puede calificar la abren; Rebote abre
  // Medidas y deja solo las con rebote (i.rebote, el mismo con el que se
  // cuenta). Son excluyentes: otra la reemplaza, la misma la quita (Rebote
  // devuelve todas las medidas; las otras dejan la hoja como esta). Cambiar
  // de hoja a mano tambien la quita. Las cifras no cambian: son de los
  // filtros de dueño y tipo, como antes; la busqueda tampoco se toca.
  // % Efectividad y Tickets evitados son cifras sin registro detras.
  var HOJA_KPI = { medidas: 'medidas', rebote: 'medidas', medicion: 'medicion', sin: 'sin' };
  var SK = window.SeleccionKpi;
  var seleccion = SK ? new SK({ valida: function (k) { return Object.prototype.hasOwnProperty.call(HOJA_KPI, k); },
                                 accion: 'Mostrar su hoja en esta pestaña' }) : null;
  function soloRebote() { return !!seleccion && seleccion.clave === 'rebote'; }

  /* Pastilla de la cabecera: la misma .datos-info blanca de Orquestacion
     (assets/js/datos-info.js). El texto se pinta tal cual; vacio, sin
     pastilla. */
  function estado(txt) {
    var n = $('estado');
    if (txt) { DatosInfo.mensaje(n, txt); return; }
    n.textContent = '';
    n.classList.remove('datos-info');
    n.removeAttribute('title');
  }
  function error(txt) { $('error').hidden = !txt; $('error-msg').textContent = txt || ''; }

  /* ------------------------------------------------------------ carga */
  /* fondo = refresco (el automatico de dashboard.js o "Actualizar"): la
     misma peticion, sin "Cargando…"; los filtros, la busqueda, el orden, la
     hoja a la vista y los motivos desplegados se quedan. Si falla, lo que se
     ve se queda y la pastilla lo avisa. -> Promise (null, o el estado HTTP
     del fallo). */
  var enVuelo = false, cargadoUnaVez = false;
  function cargar(fondo) {
    fondo = fondo === true && cargadoUnaVez;
    if (!fondo) { estado('Cargando…'); error(''); }
    enVuelo = true;
    var http = null;
    return fetch(API, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        http = r.status;
        return r.json().catch(function () { return { error: 'HTTP ' + r.status }; })
          .then(function (j) { if (!r.ok && !j.error) j.error = 'HTTP ' + r.status; return j; });
      })
      .then(function (j) {
        if (j.error) throw new Error(j.error);
        datos = j;
        cargadoUnaVez = true;
        error('');
        var consultado = DatosInfo.ahoraLocal();
        if (!j.hay_calculo) {
          $('sin-calculo').hidden = false;
          $('contenido').hidden = true;
          DatosInfo.mensaje($('estado'), 'Sin cálculo', '', consultado);
          return null;
        }
        $('sin-calculo').hidden = true;
        $('contenido').hidden = false;
        var abiertos = motivosAbiertos();
        llenarSelects();
        pintar();
        abrirMotivos(abiertos);
        var c = j.corrida || {};
        DatosInfo.mensaje($('estado'), 'Cálculo del ' + dia(c.fecha_calculo) +
          (c.fecha_calculo && c.fecha_calculo.length > 10 ? ' ' + c.fecha_calculo.slice(11, 16) : ''), '', consultado);
        $('excel').disabled = false;
        return null;
      })
      .catch(function (e) {
        var msg = e && e.message ? e.message : String(e);
        if (fondo) {
          DatosInfo.avisoRefresco($('estado'), '⚠ No se pudo actualizar (' +
            DatosInfo.fechaHora(DatosInfo.ahoraLocal()) + '); se muestran los datos anteriores', msg);
          console.error('[Efectividad]', e);
        } else {
          estado('');
          error(msg);
        }
        return http === 401 || http === 403 ? http : null;
      })
      .then(function (r) { enVuelo = false; return r; });
  }

  // Motivos desplegados de "No se puede calificar" (<details>): pintarSin
  // rehace la hoja, y un refresco los vuelve a abrir por grupo y motivo.
  function motivosAbiertos() {
    return Array.prototype.map.call($('sin-grupos').querySelectorAll('details[open][data-motivo]'),
      function (d) { return d.getAttribute('data-motivo'); });
  }
  function abrirMotivos(claves) {
    Array.prototype.forEach.call($('sin-grupos').querySelectorAll('details[data-motivo]'), function (d) {
      if (claves.indexOf(d.getAttribute('data-motivo')) >= 0) d.open = true;
    });
  }

  /* Refresco automatico (dashboard.js) y boton "Actualizar". Nunca encima de
     una carga en vuelo ni antes de la primera buena; con la boleta abierta
     espera (puedeRefrescar), porque repintar cambiaria la lista de debajo
     mientras se lee. */
  function refrescar() {
    if (enVuelo || !cargadoUnaVez) return Promise.resolve(null);
    return cargar(true);
  }
  function actualizarAhora() {
    if (enVuelo) return Promise.resolve(null);
    return cargar(true);
  }

  /* ------------------------------------------------------------ filtros */
  function opciones(sel, lista, actual) {
    var html = '<option value="">— Todos —</option>';
    (lista || []).forEach(function (v) { html += '<option value="' + esc(v) + '">' + esc(v) + '</option>'; });
    sel.innerHTML = html;
    sel.value = (lista || []).indexOf(actual) >= 0 ? actual : '';
  }
  function unicos(campo) {
    var s = new Set();
    (datos.categorias || []).forEach(function (c) { if (c[campo]) s.add(c[campo]); });
    return Array.from(s).sort();
  }
  // Los selects encadenados de Experiencia: Director -> sus PO; Manager -> sus SO.
  function llenarPO() { opciones($('po'), f.dir ? ((datos.jerarquia || {})[f.dir] || []) : unicos('po'), f.po); f.po = $('po').value; }
  function llenarSO() { opciones($('so'), f.mgr ? ((datos.jerarquia_mgr || {})[f.mgr] || []) : unicos('so'), f.so); f.so = $('so').value; }
  function llenarSelects() {
    opciones($('dir'), datos.directores || [], f.dir);
    opciones($('mgr'), datos.managers || [], f.mgr);
    opciones($('tipo'), Calc.tipos(datos.filas), f.tipo);
    llenarPO();
    llenarSO();
  }
  $('dir').onchange = function () { f.dir = this.value; f.po = ''; llenarPO(); pintar(); };
  $('po').onchange = function () { f.po = this.value; pintar(); };
  $('mgr').onchange = function () { f.mgr = this.value; f.so = ''; llenarSO(); pintar(); };
  $('so').onchange = function () { f.so = this.value; pintar(); };
  $('tipo').onchange = function () { f.tipo = this.value; pintar(); };
  $('limpiar').onclick = function () {
    f = { dir: '', po: '', mgr: '', so: '', tipo: '' };
    busqueda = '';
    if (seleccion) seleccion.limpiar();
    $('buscar').value = '';
    if (datos && datos.hay_calculo) { llenarSelects(); pintar(); }
  };
  $('buscar').oninput = function () { busqueda = this.value; pintarMedidas(); };

  /* ------------------------------------------------------------ pintado */
  function pintar() {
    vista.filas = Calc.filtrar(datos, f);
    vista.medidas = Calc.medidas(vista.filas);
    vista.enMedicion = Calc.enMedicion(vista.filas);
    vista.sin = Calc.noCalificables(vista.filas);
    vista.resumen = Calc.resumen(vista.filas);
    pintarKpis();
    pintarMedidas();
    pintarMedicion();
    pintarSin();
    var r = vista.resumen;
    $('p-medidas').innerHTML = 'Medidas<span class="ef-n">' + n0(r.medidas) + '</span>';
    $('p-medicion').innerHTML = 'En medición<span class="ef-n">' + n0(r.en_medicion) + '</span>';
    $('p-sin').innerHTML = 'No se puede calificar<span class="ef-n">' + n0(r.no_calificables) + '</span>';
  }

  // k: la clave de la tarjeta que abre su hoja (ver `seleccion` arriba).
  function tarjeta(l, v, foot, s, k) {
    var filtra = !!(k && seleccion);
    return '<div class="kpi ' + (s ? 's' + s : '') + (filtra ? seleccion.clases(k) : '') + '"><div class="lbl">' + esc(l) + '</div>' +
      '<div class="val">' + v + '</div><div class="foot">' + foot + '</div>' +
      (filtra ? seleccion.boton(k, l + ': ' + v) : '') + '</div>';
  }

  function pintarKpis() {
    var r = vista.resumen;
    var kpi = r.kpi == null
      ? tarjeta('% Efectividad', 'S/D', r.en_medicion ? n0(r.en_medicion) + ' en medición, la primera el ' + esc(diaMes(r.primera)) : 'sin iniciativas medidas', null)
      : tarjeta('% Efectividad', esc(pct(r.kpi)), n1(r.logro) + ' de ' + n1(r.comp) + ' tickets/mes', Calc.sem(r.kpi));
    $('kpis').innerHTML = kpi +
      tarjeta('Iniciativas medidas', n0(r.medidas),
        n0(r.efectivas) + ' efectivas · ' + n0(r.parciales) + ' parciales · ' + n0(r.sin_baja) + ' sin baja', null, 'medidas') +
      tarjeta('Tickets evitados', n0(r.evitados), 'desde su cierre, contra lo esperado', null) +
      tarjeta('Rebote', n0(r.con_rebote),
        r.evaluables_rebote ? 'de ' + n0(r.evaluables_rebote) + ' que ya cumplen 180 días del cierre' : 'ninguna cumple aún 180 días del cierre', null, 'rebote') +
      tarjeta('En medición', n0(r.en_medicion),
        r.primera ? 'la primera se califica el ' + esc(diaMes(r.primera)) : 'ninguna', null, 'medicion') +
      tarjeta('No se puede calificar', n0(r.no_calificables),
        n0(r.por_corregir) + ' con datos por corregir en el Excel', null, 'sin');
  }

  // ---- Medidas -------------------------------------------------------------
  var COLS_MEDIDAS = [
    { id: 'folio', t: 'Folio' }, { id: 'titulo', t: 'Iniciativa' }, { id: 'prefijo', t: 'Tipo' },
    { id: 'comp', t: 'Prometió', n: true }, { id: 'logro', t: 'Logró', n: true },
    { id: 'efectividad', t: '%', n: true }, { id: 'calificacion', t: 'Calificación' },
    { id: 'evitados', t: 'Evitados', n: true },
  ];
  var RANGO_CAL = { efectiva: 0, parcial: 1, sin_baja: 2, sin_comp: 3 };

  function coincide(i, q) {
    if (!q) return true;
    q = q.toLowerCase();
    if (String(i.folio || '').toLowerCase().indexOf(q) >= 0) return true;
    if (String(i.titulo || '').toLowerCase().indexOf(q) >= 0) return true;
    return i.filas.some(function (r) { return String(r.categoria || '').toLowerCase().indexOf(q) >= 0; });
  }

  function pintarMedidas() {
    var r = vista.resumen;
    $('conteo-cal').innerHTML = pill('efectiva') + ' ' + n0(r.efectivas) + ' &nbsp; ' + pill('parcial') + ' ' + n0(r.parciales) +
      ' &nbsp; ' + pill('sin_baja') + ' ' + n0(r.sin_baja) + (r.con_rebote ? ' &nbsp; <span class="ef-rebote">↺ ' + n0(r.con_rebote) + ' con rebote</span>' : '');

    var rebote = soloRebote();
    var lista = vista.medidas.filter(function (i) { return (!rebote || i.rebote) && coincide(i, busqueda.trim()); });
    var c = orden.col, d = orden.dir;
    lista.sort(function (a, b) {
      var x = a[c], y = b[c];
      if (c === 'calificacion') { x = RANGO_CAL[x]; y = RANGO_CAL[y]; }
      if (x == null && y == null) return 0;
      if (x == null) return 1;
      if (y == null) return -1;
      if (typeof x === 'string') return d * x.localeCompare(y);
      return d * (x - y) || String(a.folio).localeCompare(String(b.folio));
    });

    var html = '<thead><tr>' + COLS_MEDIDAS.map(function (k) {
      var s = orden.col === k.id ? (orden.dir > 0 ? 'ascending' : 'descending') : 'none';
      return '<th scope="col" data-col="' + k.id + '"' + (k.n ? ' class="n"' : '') + ' aria-sort="' + s + '" tabindex="0">' + esc(k.t) + '</th>';
    }).join('') + '</tr></thead><tbody>';
    if (!lista.length) {
      html += '<tr class="vacia"><td colspan="' + COLS_MEDIDAS.length + '">' +
        (!vista.medidas.length ? 'No hay iniciativas medidas con estos filtros.'
          : rebote && !busqueda.trim() ? 'Ninguna iniciativa medida con rebote con estos filtros.'
          : rebote ? 'Ninguna con rebote coincide con la búsqueda.' : 'Ninguna coincide con la búsqueda.') + '</td></tr>';
    }
    lista.forEach(function (i) {
      html += '<tr class="abre" tabindex="0" data-folio="' + esc(i.folio) + '">' +
        '<td class="ef-folio">' + esc(i.folio) + '</td>' +
        '<td class="largo">' + esc(i.titulo || '(sin título)') +
          '<div class="ef-cats">' + n0(i.filas.length) + (i.filas.length === 1 ? ' categoría' : ' categorías') + '</div></td>' +
        '<td class="c">' + esc(i.prefijo) + '</td>' +
        '<td class="n">' + n1(i.comp) + '</td>' +
        '<td class="n">' + n1(i.logro) + '</td>' +
        '<td class="n">' + medidor(i.efectividad) + esc(pct(i.efectividad)) + '</td>' +
        '<td class="c">' + pill(i.calificacion) + (i.rebote ? ' <span class="ef-rebote" title="Bajó, pero a los 180 días ya volvió a subir">↺ rebote</span>' : '') + '</td>' +
        '<td class="n">' + n0(i.evitados) + '</td></tr>';
    });
    $('t-medidas').innerHTML = html + '</tbody>';
  }

  function ordenarPor(col) {
    if (orden.col === col) orden.dir = -orden.dir;
    else { orden.col = col; orden.dir = (col === 'folio' || col === 'titulo' || col === 'prefijo' || col === 'calificacion') ? 1 : -1; }
    pintarMedidas();
  }
  $('t-medidas').addEventListener('click', function (e) {
    var th = e.target.closest('th[data-col]');
    if (th) { ordenarPor(th.getAttribute('data-col')); return; }
    var tr = e.target.closest('tr[data-folio]');
    if (tr) abrirBoleta(tr.getAttribute('data-folio'));
  });
  $('t-medidas').addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var th = e.target.closest('th[data-col]');
    if (th) { e.preventDefault(); ordenarPor(th.getAttribute('data-col')); return; }
    var tr = e.target.closest('tr[data-folio]');
    if (tr) { e.preventDefault(); abrirBoleta(tr.getAttribute('data-folio')); }
  });

  // ---- En medicion ----------------------------------------------------------
  function pintarMedicion() {
    graficaCalendario($('g-calendario'), Calc.calendario(vista.filas));
    var html = '<thead><tr><th scope="col">Folio</th><th scope="col">Iniciativa</th><th scope="col">Tipo</th>' +
      '<th scope="col">Cierre</th><th scope="col">Se califica el</th><th scope="col" class="n">Prometió</th></tr></thead><tbody>';
    if (!vista.enMedicion.length) html += '<tr class="vacia"><td colspan="6">Ninguna iniciativa en medición con estos filtros.</td></tr>';
    vista.enMedicion.forEach(function (i) {
      html += '<tr class="abre" tabindex="0" data-folio="' + esc(i.folio) + '">' +
        '<td class="ef-folio">' + esc(i.folio) + '</td>' +
        '<td class="largo">' + esc(i.titulo || '(sin título)') + '</td>' +
        '<td class="c">' + esc(i.prefijo) + '</td>' +
        '<td class="c">' + esc(dia(i.cierre)) + '</td>' +
        '<td class="c"><b>' + esc(dia(i.se_mide_desde)) + '</b></td>' +
        '<td class="n">' + n1(i.comp) + '</td></tr>';
    });
    $('t-medicion').innerHTML = html + '</tbody>';
  }
  $('t-medicion').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-folio]');
    if (tr) abrirBoleta(tr.getAttribute('data-folio'));
  });
  $('t-medicion').addEventListener('keydown', function (e) {
    var tr = e.target.closest('tr[data-folio]');
    if (tr && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); abrirBoleta(tr.getAttribute('data-folio')); }
  });

  // ---- No se puede calificar --------------------------------------------------
  function pintarSin() {
    var html = '';
    vista.sin.forEach(function (g) {
      html += '<section class="ef-grupo"><h4>' + esc(g.titulo) + ' <span>' + n0(g.folios.size) +
        (g.folios.size === 1 ? ' iniciativa' : ' iniciativas') + '</span></h4><p class="nota">' + esc(g.nota) + '</p>';
      if (!g.motivos.length) html += '<p class="nota">Ninguna con estos filtros.</p>';
      g.motivos.forEach(function (m) {
        html += '<details data-motivo="' + esc(g.id + '|' + m.motivo) + '"><summary>' + esc(m.motivo) + ' — <b>' + n0(m.folios.size) + '</b>' +
          (m.folios.size === 1 ? ' iniciativa' : ' iniciativas') + '</summary>' +
          '<div class="ef-tabla-wrap"><table class="ef-tabla"><thead><tr><th scope="col">Folio</th><th scope="col">Iniciativa</th>' +
          '<th scope="col">Estado</th><th scope="col">Categoría en el Excel</th></tr></thead><tbody>' +
          m.filas.map(function (r) {
            return '<tr><td class="ef-folio">' + esc(r.folio) + '</td><td class="largo">' + esc(r.titulo || '(sin título)') +
              '</td><td class="c">' + esc(r.estado) + '</td><td class="ruta">' + esc(r.categoria_excel || '(vacía)') + '</td></tr>';
          }).join('') + '</tbody></table></div></details>';
      });
      html += '</section>';
    });
    $('sin-grupos').innerHTML = html;
  }

  // ---- Vistas ------------------------------------------------------------------
  function mostrarHoja(nombre) {
    Array.prototype.forEach.call($('pestanas').querySelectorAll('button[data-hoja]'), function (x) {
      var si = x.getAttribute('data-hoja') === nombre;
      x.setAttribute('aria-selected', si ? 'true' : 'false');
      document.getElementById(PREFIJO + 'h-' + x.getAttribute('data-hoja')).hidden = !si;
    });
  }
  $('pestanas').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-hoja]');
    if (!b) return;
    var hoja = b.getAttribute('data-hoja');
    mostrarHoja(hoja);
    // Otra hoja a mano quita la tarjeta elegida (y con ella el "solo rebote").
    if (seleccion && seleccion.clave && HOJA_KPI[seleccion.clave] !== hoja) {
      seleccion.limpiar();
      if (vista.resumen) { pintarKpis(); pintarMedidas(); }
    }
  });
  if (SK) SK.escuchar([$('kpis')], 'data-indicador', function (k) {
    if (!vista.resumen) return;
    seleccion.alternar(k);
    if (seleccion.clave) {
      mostrarHoja(HOJA_KPI[seleccion.clave]);
      $('pestanas').scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    pintarKpis();
    pintarMedidas();
    SK.enfocar([$('kpis')], 'data-indicador', k);
  });

  /* ------------------------------------------------------------ graficas */
  var SVGNS = 'http://www.w3.org/2000/svg';
  function el(nombre, attrs, padre) {
    var n = document.createElementNS(SVGNS, nombre);
    for (var k in attrs) if (Object.prototype.hasOwnProperty.call(attrs, k)) n.setAttribute(k, attrs[k]);
    if (padre) padre.appendChild(n);
    return n;
  }
  function texto(padre, x, y, s, attrs) {
    var t = el('text', Object.assign({ x: x, y: y }, attrs || {}), padre);
    t.textContent = s;
    return t;
  }
  // Barra con el extremo de datos redondeado (4px) y la base recta.
  function barraH(padre, x, y, w, h, clase) {
    var r = Math.min(4, w / 2, h / 2);
    if (w <= 0) return null;
    return el('path', { class: clase, d: 'M' + x + ',' + y + 'h' + (w - r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r +
      'v' + (h - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + (-r) + ',' + r + 'h' + (-(w - r)) + 'z' }, padre);
  }
  function barraV(padre, x, base, w, h, clase) {
    var r = Math.min(4, w / 2, h / 2);
    if (h <= 0) return null;
    return el('path', { class: clase, d: 'M' + x + ',' + base + 'v' + (-(h - r)) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + (-r) +
      'h' + (w - 2 * r) + 'a' + r + ',' + r + ' 0 0 1 ' + r + ',' + r + 'v' + (h - r) + 'z' }, padre);
  }

  var tip = $('tip');
  function verTip(e, txt) {
    tip.textContent = txt;
    tip.hidden = false;
    var x = e.clientX, y = e.clientY;
    if (x == null) { var b = e.target.getBoundingClientRect(); x = b.left + b.width / 2; y = b.top; }
    tip.style.left = Math.min(x + 12, window.innerWidth - tip.offsetWidth - 8) + 'px';
    tip.style.top = Math.max(8, y - tip.offsetHeight - 10) + 'px';
  }
  function ocultarTip() { tip.hidden = true; }
  function conTip(nodo, txt) {
    nodo.setAttribute('tabindex', '0');
    nodo.setAttribute('aria-label', txt.replace(/\n/g, ', '));
    nodo.addEventListener('pointermove', function (e) { verTip(e, txt); });
    nodo.addEventListener('pointerleave', ocultarTip);
    nodo.addEventListener('focus', function (e) { verTip(e, txt); });
    nodo.addEventListener('blur', ocultarTip);
  }

  // Columnas: cuantas iniciativas se califican cada mes. Una sola serie, el
  // titulo de la vista ya dice que es; el valor va sobre cada columna.
  function graficaCalendario(cont, meses) {
    cont.innerHTML = '';
    if (!meses.length) { cont.innerHTML = '<p class="nota">Ninguna iniciativa en medición con estos filtros.</p>'; return; }
    var banda = 88, alto = 170, arriba = 22, abajo = 26, izq = 8;
    var ancho = izq * 2 + banda * meses.length;
    var max = Math.max.apply(null, meses.map(function (m) { return m.iniciativas; }));
    var svg = el('svg', { viewBox: '0 0 ' + ancho + ' ' + alto, width: ancho, height: alto, role: 'img',
      'aria-label': 'Iniciativas que se califican por mes' }, cont);
    var base = alto - abajo, util = base - arriba;
    el('line', { class: 'eje', x1: izq, x2: ancho - izq, y1: base + 0.5, y2: base + 0.5 }, svg);
    meses.forEach(function (m, k) {
      var x0 = izq + k * banda, w = 24, h = max > 0 ? Math.max(2, util * m.iniciativas / max) : 0;
      var hit = el('rect', { class: 'hit', x: x0, y: arriba - 18, width: banda, height: util + 18 + abajo }, svg);
      barraV(svg, x0 + (banda - w) / 2, base, w, h, 'barra');
      texto(svg, x0 + banda / 2, base - h - 6, n0(m.iniciativas), { class: 'etq', 'text-anchor': 'middle' });
      texto(svg, x0 + banda / 2, base + 17, mesAnio(m.mes), { 'text-anchor': 'middle' });
      conTip(hit, mesAnio(m.mes) + '\n' + n0(m.iniciativas) + (m.iniciativas === 1 ? ' iniciativa' : ' iniciativas') +
        '\nprometen ' + n1(m.comp) + ' tickets/mes');
    });
  }

  // Barras horizontales de una categoria: antes, lo esperado, despues y hoy,
  // en tickets al mes. "Despues" es la que importa (acento); las demas son
  // contexto (gris). La meta es una marca vertical.
  // Se dibuja con el ancho que de verdad tiene (la boleta ya esta abierta):
  // en una pantalla angosta las etiquetas son cortas en vez de encoger todo.
  function graficaCategoria(cont, r) {
    var ancho = Math.max(300, Math.min(640, cont.clientWidth || 640));
    var corto = ancho < 520;
    var filas = [
      { l: corto ? 'Antes' : 'Antes (por mes)', v: r.base_mes, gris: true },
      { l: corto ? 'Esperado' : 'Esperado sin la iniciativa', v: r.esperado_mes, gris: true },
      { l: corto ? 'Después' : 'Después del cierre (90 días)', v: r.despues_mes, gris: false },
    ];
    if (r.hoy_mes != null) filas.push({ l: corto ? 'Últimos 90 d' : 'Últimos 90 días', v: r.hoy_mes, gris: true });
    filas = filas.filter(function (x) { return x.v != null; });
    if (!filas.length) return;
    var m = metaAlcanzable(r) ? Calc.meta(r) : null;
    var izq = corto ? 92 : 190, der = 56, fila = 30, arriba = m != null ? 20 : 6;
    var area = ancho - izq - der, alto = arriba + fila * filas.length + 6;
    var max = Math.max.apply(null, filas.map(function (x) { return x.v; }).concat(m != null ? [m] : [])) || 1;
    var esc2 = function (v) { return area * v / max; };
    var svg = el('svg', { viewBox: '0 0 ' + ancho + ' ' + alto, width: ancho, height: alto, role: 'img',
      'aria-label': 'Tickets al mes de ' + (r.categoria || '') }, cont);
    el('line', { class: 'eje', x1: izq + 0.5, x2: izq + 0.5, y1: arriba - 4, y2: alto - 4 }, svg);
    filas.forEach(function (x, k) {
      var y = arriba + k * fila + 6, h = 18;
      var hit = el('rect', { class: 'hit', x: 0, y: y - 6, width: ancho, height: fila }, svg);
      barraH(svg, izq, y, Math.max(1, esc2(x.v)), h, 'barra' + (x.gris ? ' gris' : ''));
      texto(svg, izq - 8, y + 13, x.l, { 'text-anchor': 'end' });
      texto(svg, izq + esc2(x.v) + 6, y + 13, n1(x.v), { class: 'etq' });
      conTip(hit, x.l + '\n' + n1(x.v) + ' tickets/mes');
    });
    if (m != null) {
      var xm = izq + esc2(m);
      el('line', { class: 'meta', x1: xm, x2: xm, y1: arriba - 4, y2: alto - 4 }, svg);
      texto(svg, xm, arriba - 8, 'meta ' + n1(m), { class: 'etq-meta', 'text-anchor': 'middle' });
    }
  }

  // Con la parte que le toca, ¿se podia lograr todo lo prometido? Si la meta
  // queda por debajo de 0 tickets, no: se dice en texto y no se dibuja.
  function metaAlcanzable(r) {
    return r.parte > 0 && r.esperado_mes != null && r.comp != null && r.esperado_mes - r.comp / r.parte >= 0;
  }

  /* ------------------------------------------------------------ la boleta */
  var boleta = $('boleta');
  $('b-cerrar').onclick = function () { boleta.close(); };
  boleta.addEventListener('click', function (e) { if (e.target === boleta) boleta.close(); });
  boleta.addEventListener('close', ocultarTip);

  function dato(l, v, p) {
    return '<div class="ef-b-dato"><div class="l">' + esc(l) + '</div><div class="v">' + v + '</div>' +
      (p ? '<div class="p">' + p + '</div>' : '') + '</div>';
  }

  function abrirBoleta(folio) {
    var med = vista.medidas.filter(function (i) { return i.folio === folio; })[0];
    var enm = vista.enMedicion.filter(function (i) { return i.folio === folio; })[0];
    var i = med || enm;
    if (!i) return;
    var otras = vista.filas.filter(function (r) { return r.folio === folio && r.orden !== Calc.MEDIDA && r.orden !== Calc.MEDICION; });

    $('b-folio').textContent = i.folio + (i.prefijo ? ' · ' + i.prefijo : '');
    $('b-titulo').textContent = i.titulo || '(sin título)';
    $('b-sub').innerHTML = (med ? pill(med.calificacion) + (med.rebote ? ' <span class="ef-rebote">↺ rebote</span>' : '') : '<span class="pill neutro">En medición</span>') +
      ' <span>Estado: ' + esc(i.estado || '—') + '</span><span>Creada: ' + esc(dia(i.creacion)) + '</span>' +
      '<span>Cierre: ' + esc(dia(i.cierre)) + '</span>';

    var cuerpo = $('b-cuerpo');
    var pendientes = [];          // las graficas se dibujan ya con la boleta abierta
    var html = '<div class="ef-b-resumen">';
    if (med) {
      html += dato('Prometió', n1(med.comp), 'tickets/mes menos') +
        dato('Logró', n1(med.logro), 'tickets/mes menos') +
        dato('Efectividad', esc(pct(med.efectividad)), med.empeoro ? 'la categoría quedó peor que lo esperado' : '') +
        dato('Evitados', n0(med.evitados), 'tickets desde el cierre');
    } else {
      html += dato('Prometió', n1(enm.comp), 'tickets/mes menos') +
        dato('Se califica el', esc(dia(enm.se_mide_desde)), '90 días después del cierre');
    }
    html += '</div>';
    cuerpo.innerHTML = html;

    i.filas.forEach(function (r) {
      var sec = document.createElement('section');
      sec.className = 'ef-b-cat';
      var t = '<h3>' + esc(r.categoria) + '</h3>';
      if (r.traducida) t += '<div class="ef-b-nota">En el Excel: ' + esc(r.categoria_excel) + ' (la ruta cambió; se cuenta la nueva)</div>';
      if (r.es_rama) t += '<div class="ef-b-nota">Apunta a una rama: se cuenta la rama completa.</div>';
      t += '<p class="ef-b-texto">Prometió bajar <b>' + esc(pct(r.pct)) + '</b> de <b>' + n1(r.base_mes) +
        '</b> tickets al mes: <b>' + n1(r.comp) + '</b> menos al mes.';
      if (r.orden === Calc.MEDIDA) {
        t += ' Sin la iniciativa se esperaban <b>' + n1(r.esperado_mes) + '</b>; hubo <b>' + n1(r.despues_mes) +
          '</b>. Logró <b>' + n1(r.logro) + '</b> de ' + n1(r.comp) + '.';
      } else {
        t += ' Se califica el <b>' + esc(dia(r.se_mide_desde)) + '</b>.';
      }
      t += '</p>';
      if (r.orden === Calc.MEDIDA && r.parte != null && r.parte < 0.9999)
        t += '<div class="ef-b-nota">Esta categoría la comparten varias iniciativas: a ésta le toca el ' + esc(pct(r.parte)) + ' de la baja.</div>';
      if (r.orden === Calc.MEDIDA && r.parte > 0 && !metaAlcanzable(r))
        t += '<div class="ef-b-nota">Con la parte que le toca, lo prometido no se alcanzaba ni bajando a 0 tickets: su logro tiene tope en lo que bajó.</div>';
      sec.innerHTML = t;
      if (r.orden === Calc.MEDIDA) {
        var g = document.createElement('div');
        g.className = 'ef-grafica';
        sec.appendChild(g);
        pendientes.push([g, r]);
      }
      cuerpo.appendChild(sec);
    });

    if (otras.length) {
      var s2 = document.createElement('section');
      s2.className = 'ef-b-cat';
      s2.innerHTML = '<h3>Categorías que no se califican</h3><ul class="ef-b-texto">' + otras.map(function (r) {
        return '<li>' + esc(r.categoria_excel || '(vacía)') + ': ' + esc(r.motivo) + '</li>';
      }).join('') + '</ul>';
      cuerpo.appendChild(s2);
    }

    if (typeof boleta.showModal === 'function') boleta.showModal(); else boleta.setAttribute('open', '');
    pendientes.forEach(function (x) { graficaCategoria(x[0], x[1]); });
    boleta.scrollTop = 0;
  }

  /* ------------------------------------------------------------ Excel */
  var xlsxListo = null;
  function cargarXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return xlsxListo || (xlsxListo = new Promise(function (ok, mal) {
      var s = document.createElement('script');
      s.src = XLSX_URL;
      s.onload = function () { ok(window.XLSX); };
      s.onerror = function () { xlsxListo = null; mal(new Error('no se pudo cargar ' + XLSX_URL)); };
      document.head.appendChild(s);
    }));
  }

  function hoja(XLSX, filas, anchos) {
    var ws = XLSX.utils.aoa_to_sheet(filas);
    ws['!cols'] = anchos.map(function (w) { return { wch: w }; });
    return ws;
  }
  function r4(v) { return v == null ? null : Math.round(v * 10000) / 10000; }
  function filtrosTexto() {
    var p = [];
    if (f.dir) p.push('Director: ' + f.dir);
    if (f.po) p.push('Product Owner: ' + f.po);
    if (f.mgr) p.push('Manager: ' + f.mgr);
    if (f.so) p.push('Service Owner: ' + f.so);
    if (f.tipo) p.push('Tipo: ' + f.tipo);
    return p.length ? p.join(' · ') : 'Sin filtros';
  }

  $('excel').onclick = function () {
    var boton = this;
    boton.disabled = true;
    cargarXlsx().then(function (XLSX) {
      var r = vista.resumen, c = datos.corrida || {};
      var wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, [
        ['Efectividad de iniciativas'],
        ['Cálculo del', c.fecha_calculo || ''],
        ['Filtros', filtrosTexto()],
        [],
        ['% Efectividad', r4(r.kpi)],
        ['Prometido (tickets/mes)', r4(r.comp)],
        ['Logrado (tickets/mes)', r4(r.logro)],
        ['Iniciativas medidas', r.medidas],
        ['Efectivas (90% o más)', r.efectivas],
        ['Parciales', r.parciales],
        ['Sin baja', r.sin_baja],
        ['Tickets evitados', r4(r.evitados)],
        ['Con rebote', r.con_rebote],
        ['Ya cumplen 180 días (pueden rebotar)', r.evaluables_rebote],
        ['En medición', r.en_medicion],
        ['La primera se califica el', r.primera || ''],
        ['No se pueden calificar', r.no_calificables],
        ['Con datos por corregir en el Excel', r.por_corregir],
      ], [38, 60]), 'Resumen');

      var m = [['Folio', 'Iniciativa', 'Tipo', 'Estado', 'Agrupador', 'Creación', 'Cierre', 'Categorías',
        'Prometió (tickets/mes)', 'Logró (tickets/mes)', '% efectividad', 'Calificación', 'Rebote', 'Tickets evitados']];
      vista.medidas.forEach(function (i) {
        m.push([i.folio, i.titulo, i.prefijo, i.estado, i.agrup, i.creacion, i.cierre, i.filas.length,
          r4(i.comp), r4(i.logro), r4(i.efectividad), (CAL[i.calificacion] || CAL.sin_comp).texto,
          i.rebote ? 'Sí' : (i.evalua_rebote_real ? 'No' : 'Aún no cumple 180 días'), r4(i.evitados)]);
      });
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, m, [16, 50, 7, 14, 11, 11, 11, 10, 12, 12, 12, 14, 18, 12]), 'Medidas');

      var d = [['Folio', 'Iniciativa', 'Tipo', 'Categoría en el Excel', 'Categoría que se cuenta', 'Ruta traducida', 'Es rama',
        '%', 'Días de base', 'Antes (tickets/mes)', 'Esperado (tickets/mes)', 'Después (tickets/mes)', 'Últimos 90 días (tickets/mes)',
        'Factor del resto', 'Parte que le toca', 'Prometió', 'Logró', 'Meta (tickets/mes)', 'Tickets evitados', 'Se mide desde']];
      vista.filas.filter(function (x) { return x.orden === Calc.MEDIDA; }).forEach(function (x) {
        d.push([x.folio, x.titulo, x.prefijo, x.categoria_excel, x.categoria, x.traducida ? 'Sí' : 'No', x.es_rama ? 'Sí' : 'No',
          r4(x.pct), x.dias_base, r4(x.base_mes), r4(x.esperado_mes), r4(x.despues_mes), r4(x.hoy_mes),
          r4(x.factor), r4(x.parte), r4(x.comp), r4(x.logro), r4(Calc.meta(x)), r4(x.evitados), x.se_mide_desde]);
      });
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, d, [16, 44, 7, 40, 40, 9, 8, 7, 8, 11, 11, 11, 11, 9, 9, 10, 10, 11, 10, 12]), 'Detalle por categoría');

      var e = [['Folio', 'Iniciativa', 'Tipo', 'Estado', 'Cierre', 'Se califica el', 'Prometió (tickets/mes)', 'Categorías']];
      vista.enMedicion.forEach(function (i) {
        e.push([i.folio, i.titulo, i.prefijo, i.estado, i.cierre, i.se_mide_desde, r4(i.comp), i.filas.length]);
      });
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, e, [16, 50, 7, 14, 11, 13, 12, 10]), 'En medición');

      var s = [['Grupo', 'Motivo', 'Folio', 'Iniciativa', 'Tipo', 'Estado', 'Categoría en el Excel', '%', 'Creación', 'Cierre']];
      vista.sin.forEach(function (g) {
        g.motivos.forEach(function (mo) {
          mo.filas.forEach(function (x) {
            s.push([g.titulo, mo.motivo, x.folio, x.titulo, x.prefijo, x.estado, x.categoria_excel, r4(x.pct), x.creacion, x.cierre]);
          });
        });
      });
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, s, [22, 44, 16, 44, 7, 14, 40, 7, 11, 11]), 'No se puede calificar');

      var sufijo = f.tipo || f.so || f.mgr || f.po || f.dir ? '_filtrado' : '';
      XLSX.writeFile(wb, 'Efectividad_iniciativas_' + (datos.hoy || '') + sufijo + '.xlsx');
    }).catch(function (e2) {
      error('No se pudo armar el Excel: ' + (e2 && e2.message ? e2.message : e2));
    }).then(function () { boton.disabled = false; });
  };

  /* ------------------------------------------------------------ arranque */
  if (window.RefrescoAuto) RefrescoAuto.cablearBoton($('actualizar'), actualizarAhora);
  window.TableroEfectividadModulo = {
    redimensionar: function () { /* las graficas son SVG con viewBox: se ajustan solas */ },
    recargar: function () { return cargar(); },
    refrescar: refrescar,
    puedeRefrescar: function () { return !boleta.open; },
  };
  cargar();
})();
