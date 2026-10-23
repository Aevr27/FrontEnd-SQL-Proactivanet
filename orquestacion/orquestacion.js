/* =========================================================================
   orquestacion/orquestacion.js

   Pestaña "Orquestación". Un solo archivo para la pagina suelta
   (orquestacion/orquestacion.html) y para la pestaña del tablero, que monta
   ese mismo marcado e inyecta este mismo script (TableroOrquestacion en
   dashboard.js).

   De donde sale cada cosa: handlers/orquestacion.ashx, que lee las vistas del
   77 (77_tablero_orquestacion.sql) sobre el esquema orq. Cada job llega con
   cada indicador ya resuelto en 1 o 0 (orq.vw_TableroJob): las reglas viven
   en SQL. Aqui NO se decide si un job cuenta: solo se filtra, se suma y se
   pinta.

   Dos partes:
     1. OrquestacionCalc: las cuentas, sin DOM. Las prueba node
        (tools/tests/OrquestacionPestanaSmoke.js) con la respuesta real del
        handler sobre una base de prueba.
     2. La pestaña: filtros, tarjetas, tablas, graficas (Chart.js, el del
        tablero), la lista de jobs (?detalle=1, al abrirla) y el Excel
        (SheetJS, orquestacion/vendor/xlsx.mini.min.js, al pulsar).

   Antes esta pestaña era la "Orquestación" del documento que genera
   TableroExperiencia_v3.7.exe (pestaña "Tablero"), con datos del 2026-09-02.
   Su vista sigue abajo ("Vista del tablero anterior"), con datos de la base.
   ========================================================================= */

(function (fabrica) {
  var calc = fabrica();
  if (typeof module !== 'undefined' && module.exports) module.exports = calc;
  if (typeof window !== 'undefined') window.OrquestacionCalc = calc;
})(function () {
  'use strict';

  var CAMPOS = 14;

  // { cols: [...], filas: [[...]] } -> [ { col: valor } ]
  function tabla(t) {
    if (!t || !t.cols) return [];
    var cols = t.cols;
    return (t.filas || []).map(function (f) {
      var o = {};
      for (var i = 0; i < cols.length; i++) o[cols[i]] = f[i];
      return o;
    });
  }

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : 0; }
  function div(a, b) { return b ? a / b : null; }
  function suma(lista, campo, cuando) {
    var s = 0;
    for (var i = 0; i < lista.length; i++)
      if (!cuando || cuando(lista[i])) s += num(lista[i][campo]);
    return s;
  }
  function cuenta(lista, cuando) {
    var n = 0;
    for (var i = 0; i < lista.length; i++) if (cuando(lista[i])) n++;
    return n;
  }
  function es(campo) { return function (o) { return o[campo] === 1; }; }

  // ---- Filtros -------------------------------------------------------------
  // dir y n3: los del dashboard del Excel (columnas AQ y AR: "Huérfanos" y
  // "Sin N3" cuando vienen vacios). cand: varios valores de "¿Es candidato?";
  // vacio no restringe.
  function hayFiltro(f) { return !!(f && (f.dir || f.n3 || f.herr || (f.cand && f.cand.length))); }
  function pasa(o, f) {
    if (f.dir && o.Dir !== f.dir) return false;
    if (f.n3 && o.N3 !== f.n3) return false;
    if (f.herr && o.Herramienta !== f.herr) return false;
    if (f.cand && f.cand.length && f.cand.indexOf(o.Candidato) < 0) return false;
    return true;
  }
  function filtrar(jobs, f) {
    if (!hayFiltro(f)) return jobs.slice();
    return jobs.filter(function (o) { return pasa(o, f); });
  }
  // Un decomiso entra si su job paso el filtro. Sin filtro entran todos,
  // tambien los que ya no tienen job (asi da lo mismo que la hoja Decomisos).
  function decomisosDe(decomisos, jobsFiltrados, f) {
    if (!hayFiltro(f)) return decomisos.slice();
    var ids = new Set(jobsFiltrados.map(function (j) { return j.JobId; }));
    return decomisos.filter(function (d) { return d.JobId != null && ids.has(d.JobId); });
  }

  // ---- El dashboard del Excel --------------------------------------------
  // p: orq.Parametro. Lo capturado a mano en el Excel (ejecuciones consumidas)
  // es del total: con filtros va null. Los costos NO llegan aqui: el servidor
  // no los lee (OrquestacionQueries.LeerParametros), son informacion reservada.
  function indicadores(js, decs, p, filtrado) {
    p = p || {};
    var r = {};
    r.universo = js.length;
    // Huerfanos, activos y orquestados cuentan con el MISMO predicado con el
    // que filtra la lista de jobs (LISTA): el clic en su tarjeta abre esa
    // lista y las dos cifras tienen que coincidir.
    r.huerfanos = cuenta(js, jobDe('huerfanos'));
    r.identificados = r.universo - r.huerfanos;
    r.completitud = div(suma(js, 'CamposLlenosExcel'), CAMPOS * r.universo);
    r.estricta = div(suma(js, 'CamposLlenosEstricta'), CAMPOS * r.universo);
    r.completos = cuenta(js, function (o) { return o.CamposLlenosEstricta === CAMPOS; });
    r.activos = cuenta(js, jobDe('activos'));
    r.orquestados = cuenta(js, jobDe('orquestados'));
    r.pct_orquestados = div(r.orquestados, r.activos);

    r.candidatos = cuenta(js, es('CandSi'));
    r.migrados_exito = cuenta(js, function (o) { return o.CandSi === 1 && o.Activo === 1; });
    r.pct_ingreso = div(r.migrados_exito, r.candidatos);

    r.decomisos = decs.length;
    r.decomisos_exitosos = cuenta(decs, es('Exitoso'));
    r.pct_decomisos = div(r.decomisos_exitosos, r.decomisos);

    r.ejec_calculada = suma(js, 'Prom', es('Activo'));
    r.ejec_capturada = filtrado || p.EjecucionesConsumidasDia == null ? null : p.EjecucionesConsumidasDia;
    r.pend_migrar = suma(js, 'Prom', es('PendMigrar'));
    // Lo consumido mas lo que falta migrar.
    var base = r.ejec_capturada != null ? r.ejec_capturada : r.ejec_calculada;
    r.ejec_futuras = base + r.pend_migrar;
    return r;
  }

  // Formulas B15:F19 del Excel: cada medidor con su universo.
  var MADUREZ = [
    { id: 'migrado', nombre: 'Migrado', base: 'Activo', logro: 'MadMigrado' },
    { id: 'optimizado', nombre: 'Optimizado', base: 'MadOptBase', logro: 'MadOpt' },
    { id: 'alertamiento', nombre: 'Con alertamiento', base: 'MadAlertBase', logro: 'MadAlert' },
    { id: 'redundancia', nombre: 'Sin redundancia', base: 'MadRedBase', logro: 'MadRed' },
    { id: 'sla', nombre: 'Con SLA activo', base: 'MadSlaBase', logro: 'MadSla' },
  ];
  function madurez(js) {
    return MADUREZ.map(function (m) {
      var u = cuenta(js, es(m.base)), l = cuenta(js, es(m.logro));
      return { id: m.id, nombre: m.nombre, universo: u, logrado: l, pct: div(l, u) };
    });
  }

  // ---- Direccion -> N3 (columnas D a P del Excel) --------------------------
  function nuevoGrupo(nombre) {
    return { nombre: nombre, jobs: 0, campos: 0, estricta: 0, red_cand: 0, red_exito: 0,
             dep_cand: 0, dep_exito: 0, nuevo_cand: 0, nuevo_orq: 0, adopcion: 0 };
  }
  function acumular(g, o) {
    g.jobs++;
    g.campos += num(o.CamposLlenosExcel);
    g.estricta += num(o.CamposLlenosEstricta);
    g.red_cand += o.RedCand === 1 ? 1 : 0;
    g.red_exito += o.RedExito === 1 ? 1 : 0;
    g.dep_cand += o.DepCand === 1 ? 1 : 0;
    g.dep_exito += o.DepExito === 1 ? 1 : 0;
    g.nuevo_cand += o.CandSi === 1 ? 1 : 0;
    g.nuevo_orq += o.CandSi === 1 && o.Activo === 1 ? 1 : 0;
    g.adopcion += o.Adopcion === 1 ? 1 : 0;
  }
  function cerrar(g, universo) {
    g.pct_universo = div(g.jobs, universo);
    g.campos_prom = div(g.campos, g.jobs);
    g.pct_ident = div(g.campos, CAMPOS * g.jobs);
    g.pct_estricta = div(g.estricta, CAMPOS * g.jobs);
    g.pct_red = div(g.red_exito, g.red_cand);
    // Depuracion: lo ya decomisado contra todo lo que se iba a depurar.
    g.pct_dep = div(g.dep_exito, g.dep_cand + g.dep_exito);
    return g;
  }
  function porDireccion(js) {
    var dirs = new Map();
    var total = nuevoGrupo('Total');
    js.forEach(function (o) {
      var d = dirs.get(o.Dir);
      if (!d) { d = nuevoGrupo(o.Dir); d.n3s = new Map(); dirs.set(o.Dir, d); }
      var n = d.n3s.get(o.N3);
      if (!n) { n = nuevoGrupo(o.N3); d.n3s.set(o.N3, n); }
      acumular(d, o); acumular(n, o); acumular(total, o);
    });
    var u = js.length;
    var lista = Array.from(dirs.values()).map(function (d) {
      d.n3s = Array.from(d.n3s.values()).map(function (n) { return cerrar(n, u); })
        .sort(function (a, b) { return b.jobs - a.jobs || String(a.nombre).localeCompare(String(b.nombre)); });
      return cerrar(d, u);
    }).sort(function (a, b) { return b.jobs - a.jobs || String(a.nombre).localeCompare(String(b.nombre)); });
    return { direcciones: lista, total: cerrar(total, u) };
  }

  // ---- Completitud por campo: Campos trae un caracter por campo ------------
  // 0 vacio, 1 relleno ("Ejecucion unica", "N/A"...), 2 documentado.
  function porCampo(js, campos) {
    return (campos || []).map(function (c, i) {
      var conDato = cuenta(js, function (o) { return o.Campos && o.Campos.charAt(i) !== '0'; });
      var doc = cuenta(js, function (o) { return o.Campos && o.Campos.charAt(i) === '2'; });
      return { letra: c.letra, nombre: c.nombre, con_dato: conDato, documentados: doc,
               faltantes: js.length - conDato, pct: div(conDato, js.length), pct_doc: div(doc, js.length) };
    });
  }

  // ---- La vista del tablero anterior (v3.7) --------------------------------
  var CLASIF = ['Alta', 'Media', 'Baja', 'Única'];
  function contarPor(js, campo, vacio) {
    var m = new Map();
    js.forEach(function (o) {
      var k = o[campo] == null ? vacio : o[campo];
      m.set(k, (m.get(k) || 0) + 1);
    });
    return Array.from(m.entries()).sort(function (a, b) { return b[1] - a[1] || String(a[0]).localeCompare(String(b[0])); });
  }
  function v37(js) {
    var r = {};
    r.n_jobs = js.length;
    r.n_tareas = suma(js, 'Prom');
    r.migrados = cuenta(js, function (o) { return o.Candidato === 'Migrados'; });
    r.pct_migrados = div(r.migrados, r.n_jobs);
    r.completitud = div(suma(js, 'CamposLlenosExcel'), CAMPOS * r.n_jobs);
    r.no_candidatos = cuenta(js, function (o) { return o.Candidato === 'No'; });
    r.a_decomisar = cuenta(js, function (o) { return o.Candidato === 'Para decomiso'; });
    var pc = new Map(contarPor(js, 'Clasif', 'Sin clasificación'));
    r.por_clasif = CLASIF.concat(['Sin clasificación']).map(function (k) { return [k, pc.get(k) || 0]; });
    r.por_herramienta = contarPor(js, 'Herramienta', '(sin herramienta)');
    r.por_candidato = contarPor(js, 'Candidato', '(vacío)');
    var dirs = new Map();
    js.forEach(function (o) {
      var d = dirs.get(o.Dir);
      if (!d) { d = { dir: o.Dir, n_jobs: 0, n_tareas: 0, migrados: 0, campos: 0 }; dirs.set(o.Dir, d); }
      d.n_jobs++; d.n_tareas += num(o.Prom); d.campos += num(o.CamposLlenosExcel);
      if (o.Candidato === 'Migrados') d.migrados++;
    });
    r.por_dir = Array.from(dirs.values()).map(function (d) {
      d.pct_migrados = div(d.migrados, d.n_jobs);
      d.completitud = div(d.campos, CAMPOS * d.n_jobs);
      return d;
    }).sort(function (a, b) { return b.n_jobs - a.n_jobs; });
    return r;
  }

  // ---- Historico (orq.AvanceDiario) ----------------------------------------
  var HISTORICO = [
    { id: 'UniversoJobs', nombre: 'Universo de jobs' },
    { id: 'Candidatos', nombre: 'Candidatos (¿Es candidato? = Si)' },
    { id: 'Migrados', nombre: 'Migrados' },
    { id: 'MigradosNuevos', nombre: 'Migrados nuevos (Si y activos)' },
    { id: 'CandidatosDecomiso', nombre: 'Candidatos a decomiso' },
    { id: 'TotalDecomisos', nombre: 'Decomisos exitosos' },
    { id: 'Huerfanos', nombre: 'Huérfanos' },
    { id: 'PendientesAdopcion', nombre: 'Pendientes de adopción' },
    { id: 'EjecucionesDiarias', nombre: 'Ejecuciones diarias' },
  ];
  function historico(filas, id) {
    var fechas = Array.from(new Set(filas.map(function (h) { return h.Fecha; }))).sort();
    var excel = new Map(), base = new Map();
    filas.forEach(function (h) { (h.Origen === 'Base' ? base : excel).set(h.Fecha, h[id]); });
    return {
      fechas: fechas,
      excel: fechas.map(function (d) { return excel.has(d) ? excel.get(d) : null; }),
      base: fechas.map(function (d) { return base.has(d) ? base.get(d) : null; }),
    };
  }

  // ---- La lista de jobs ----------------------------------------------------
  var LISTA = [
    { id: '', nombre: 'Todos' },
    { id: 'identificados', nombre: 'Identificados', job: function (o) { return !es('EsHuerfano')(o); } },
    { id: 'huerfanos', nombre: 'Huérfanos', job: es('EsHuerfano') },
    { id: 'incompletos', nombre: 'Sin documentar completo (estricta)', job: function (o) { return o.CamposLlenosEstricta < CAMPOS; } },
    { id: 'activos', nombre: 'Activos en Control-M', job: es('Activo') },
    { id: 'orquestados', nombre: 'Completamente orquestados', job: es('OrqCompleto') },
    { id: 'candidatos', nombre: 'Candidatos a migrar (Si)', job: es('CandSi') },
    { id: 'pendientes', nombre: 'Candidatos pendientes (N/A en Control-M)', job: es('PendMigrar') },
    { id: 'reduccion', nombre: 'Candidatos a reducción parcial', job: es('RedCand') },
    { id: 'depuracion', nombre: 'Candidatos a depuración', job: es('DepCand') },
    { id: 'adopcion', nombre: 'Huérfanos en adopción', job: es('Adopcion') },
    { id: 'advertencias', nombre: 'Con advertencias de la carga', det: function (d) { return !!d.Advertencias; } },
    { id: 'app', nombre: 'Aplicación fuera del catálogo', det: function (d) { return d.AplicacionEnCatalogo === 0; } },
    { id: 'personas', nombre: 'Responsables fuera de la hoja Datos', det: function (d) { return d.PersonasFueraDeDatos > 0; } },
  ];
  // El predicado por job de una entrada de LISTA (indicadores() lo usa para
  // contar lo mismo que la lista filtra).
  function jobDe(id) {
    var l = LISTA.filter(function (x) { return x.id === id; })[0];
    return l.job;
  }
  function normal(s) {
    return String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  var BUSCA_EN = ['JobName', 'Aplicacion', 'Dir', 'N3', 'ServiceOwnerN2', 'Escalacion1', 'Escalacion2', 'Escalacion3', 'Herramienta'];
  // jobs: los ya filtrados; detalle: Map JobId -> renglon de vw_TableroDetalle.
  function lista(jobs, detalle, indicador, texto) {
    var ind = LISTA.filter(function (l) { return l.id === (indicador || ''); })[0] || LISTA[0];
    var t = normal(texto).trim();
    var salida = [];
    jobs.forEach(function (o) {
      var d = detalle.get(o.JobId);
      if (!d) return;
      if (ind.job && !ind.job(o)) return;
      if (ind.det && !ind.det(d)) return;
      if (t && !BUSCA_EN.some(function (c) { return normal(d[c]).indexOf(t) >= 0; })) return;
      salida.push({ job: o, det: d });
    });
    return salida.sort(function (a, b) { return String(a.det.JobName).localeCompare(String(b.det.JobName)); });
  }

  // Los valores de "¿Es candidato?", del mas comun al menos.
  function candidatos(jobs) { return contarPor(jobs, 'Candidato', '(vacío)').map(function (e) { return e[0]; }); }
  function unicos(jobs, campo) {
    return Array.from(new Set(jobs.map(function (o) { return o[campo]; }).filter(function (v) { return v != null; })))
      .sort(function (a, b) { return String(a).localeCompare(String(b)); });
  }

  return {
    CAMPOS: CAMPOS, MADUREZ: MADUREZ, HISTORICO: HISTORICO, LISTA: LISTA, CLASIF: CLASIF,
    tabla: tabla, hayFiltro: hayFiltro, filtrar: filtrar, decomisosDe: decomisosDe,
    indicadores: indicadores, madurez: madurez, porDireccion: porDireccion, porCampo: porCampo,
    v37: v37, historico: historico, lista: lista, candidatos: candidatos, unicos: unicos, normal: normal,
  };
});

(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var PREFIJO = 'orq-';
  function $(id) { return document.getElementById(PREFIJO + id); }
  if (!$('kpis')) return;
  var Calc = window.OrquestacionCalc;

  // Rutas resueltas contra este script: embebido, el documento vive un nivel
  // mas arriba. document.currentScript solo vale mientras se evalua.
  var YO = document.currentScript && document.currentScript.src;
  function junto(rel, respaldo) { try { return new URL(rel, YO).href; } catch (e) { return respaldo; } }
  var API = junto('../handlers/orquestacion.ashx', 'handlers/orquestacion.ashx');
  var XLSX_URL = junto('vendor/xlsx.mini.min.js', 'orquestacion/vendor/xlsx.mini.min.js');

  /* ------------------------------------------------------------ formato */
  // El escape compartido (assets/js/escape.js): direcciones, N3, jobs y
  // aplicaciones se pegan con innerHTML y tienen que entrar como TEXTO.
  function esc(v) { return Escape.html(v); }
  var NF0 = new Intl.NumberFormat('es-MX', { maximumFractionDigits: 0 });
  var NF1 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  function n0(v) { return v == null ? '—' : NF0.format(v); }
  function n1(v) { return v == null ? '—' : NF1.format(v); }
  function pct(v) { return v == null ? '—' : Math.round(v * 100) + '%'; }
  function pct1(v) { return v == null ? '—' : NF1.format(v * 100) + '%'; }
  function dia(s) {          // 'aaaa-mm-dd' -> 'dd/mm/aaaa'
    var p = String(s || '').split('-');
    return p.length >= 3 ? p[2].slice(0, 2) + '/' + p[1] + '/' + p[0] : '—';
  }
  function diaCorto(s) {     // 'aaaa-mm-dd' -> 'dd/mm'
    var p = String(s || '').split('-');
    return p.length >= 3 ? p[2].slice(0, 2) + '/' + p[1] : s;
  }
  function sem(v) { return v == null ? null : (v >= 0.9 ? 'v' : (v >= 0.7 ? 'a' : 'r')); }
  function medidor(v) {
    if (v == null) return '';
    var x = Math.max(0, Math.min(1, v));
    return '<span class="orq-medidor ' + (x >= 0.9 ? '' : (x >= 0.7 ? 'a' : 'r')) + '" aria-hidden="true"><i style="width:' +
      Math.round(x * 100) + '%"></i></span>';
  }

  /* ------------------------------------------------------------ estado */
  var datos = null;              // la respuesta del handler
  var jobs = [], decomisos = [], historicoFilas = [];
  var detalle = null;            // Map JobId -> renglon, al abrir la lista
  var f = { dir: '', n3: '', herr: '', cand: [] };
  var vista = null;              // lo ultimo que se pinto
  var graficas = {};
  var abiertas = new Set();      // Direcciones desplegadas en la tabla
  var lista = { ind: '', texto: '', tope: 200 };

  function estado(txt) { $('estado').textContent = txt || ''; }
  function error(txt) { $('error').hidden = !txt; $('error-msg').textContent = txt || ''; }

  function pedir(url) {
    return fetch(url, { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) {
        return r.json().catch(function () { return { error: 'HTTP ' + r.status }; })
          .then(function (j) { if (!r.ok && !j.error) j.error = 'HTTP ' + r.status; return j; });
      })
      .then(function (j) { if (j.error) throw new Error(j.error); return j; });
  }

  /* ------------------------------------------------------------ carga */
  function cargar() {
    estado('Cargando…');
    error('');
    pedir(API).then(function (j) {
      datos = j;
      if (!j.hay_datos) {
        $('sin-datos').hidden = false;
        $('contenido').hidden = true;
        estado('Sin datos');
        return;
      }
      jobs = Calc.tabla(j.jobs);
      decomisos = Calc.tabla(j.decomisos);
      historicoFilas = Calc.tabla(j.historico);
      $('sin-datos').hidden = true;
      $('contenido').hidden = false;
      llenarFiltros();
      llenarHistorico();
      pintar();
      pintarCarga();
      var c = j.carga || {};
      estado('Carga del Excel: ' + dia(c.fecha) + (c.fecha && c.fecha.length > 10 ? ' ' + c.fecha.slice(11, 16) : '') +
        ' · ' + n0(jobs.length) + ' jobs');
      $('excel').disabled = false;
    }).catch(function (e) {
      estado('');
      error(e && e.message ? e.message : String(e));
    });
  }

  /* ------------------------------------------------------------ filtros */
  function opciones(sel, lista, actual, todos) {
    var html = '<option value="">' + esc(todos) + '</option>';
    lista.forEach(function (v) { html += '<option value="' + esc(v) + '">' + esc(v) + '</option>'; });
    sel.innerHTML = html;
    sel.value = lista.indexOf(actual) >= 0 ? actual : '';
  }
  function llenarN3() {
    var base = f.dir ? jobs.filter(function (o) { return o.Dir === f.dir; }) : jobs;
    opciones($('n3'), Calc.unicos(base, 'N3'), f.n3, '— Todos —');
    f.n3 = $('n3').value;
  }
  function llenarFiltros() {
    opciones($('dir'), Calc.unicos(jobs, 'Dir'), f.dir, '— Todas —');
    opciones($('herr'), Calc.unicos(jobs, 'Herramienta'), f.herr, '— Todas —');
    llenarN3();
    var html = '<span class="orq-cands-t">¿Es candidato?</span>';
    Calc.candidatos(jobs).forEach(function (v, i) {
      html += '<label><input type="checkbox" value="' + esc(v) + '" id="orq-cand-' + i + '"' +
        (f.cand.indexOf(v) >= 0 ? ' checked' : '') + '> ' + esc(v) + '</label>';
    });
    $('cands').innerHTML = html;
  }
  $('dir').onchange = function () { f.dir = this.value; f.n3 = ''; llenarN3(); pintar(); };
  $('n3').onchange = function () { f.n3 = this.value; pintar(); };
  $('herr').onchange = function () { f.herr = this.value; pintar(); };
  $('cands').addEventListener('change', function (e) {
    if (!e.target || e.target.type !== 'checkbox') return;
    f.cand = Array.prototype.slice.call($('cands').querySelectorAll('input:checked')).map(function (x) { return x.value; });
    pintar();
  });
  $('limpiar').onclick = function () {
    f = { dir: '', n3: '', herr: '', cand: [] };
    if (datos && datos.hay_datos) { llenarFiltros(); pintar(); }
  };

  /* ------------------------------------------------------------ pintado */
  function pintar() {
    var js = Calc.filtrar(jobs, f);
    var decs = Calc.decomisosDe(decomisos, js, f);
    var filtrado = Calc.hayFiltro(f);
    vista = {
      jobs: js, decomisos: decs, filtrado: filtrado,
      ind: Calc.indicadores(js, decs, datos.parametros, filtrado),
      madurez: Calc.madurez(js),
      dir: Calc.porDireccion(js),
      campos: Calc.porCampo(js, datos.campos),
      v37: Calc.v37(js),
    };
    pintarKpis();
    pintarIngreso();
    pintarMadurez();
    pintarDireccion();
    pintarCampos();
    pintarV37();
    if (detalle) pintarLista();
  }

  // k: la clave de la tarjeta que abre la lista de jobs (ver "KPI -> lista").
  function tarjeta(l, v, foot, s, k) {
    var filtra = !!(k && seleccion);
    return '<div class="kpi ' + (s ? 's' + s : '') + (filtra ? seleccion.clases(k) : '') + '"><div class="lbl">' + esc(l) + '</div>' +
      '<div class="val">' + v + '</div><div class="foot">' + foot + '</div>' +
      (filtra ? seleccion.boton(k, l + ': ' + v) : '') + '</div>';
  }
  function cifra(t, v, s, chica) {
    return '<div class="orq-cifra' + (chica ? ' chica' : '') + '"><span class="t">' + esc(t) + '</span><span class="v">' + v + '</span>' +
      (s ? '<span class="s">' + s + '</span>' : '') + '</div>';
  }

  function pintarKpis() {
    var r = vista.ind;
    marcarDesdeLista();
    $('kpis').innerHTML =
      tarjeta('Universo de jobs', n0(r.universo), 'un renglón por nombre de job', null, KPI_TODOS) +
      tarjeta('Identificados', n0(r.identificados), 'con Product Owner / N3', null, 'identificados') +
      tarjeta('Huérfanos', n0(r.huerfanos), 'Product Owner / N3 vacío o N/A', r.huerfanos ? 'a' : null, 'huerfanos') +
      tarjeta('Registro completo', pct1(r.completitud),
        'documentado (sin relleno): ' + pct1(r.estricta) + ' · ' + n0(r.completos) + ' jobs al 100%', sem(r.estricta)) +
      tarjeta('Activos en Control-M', n0(r.activos), 'Estatus control-M = Activos', null, 'activos') +
      tarjeta('Completamente orquestados', n0(r.orquestados), pct(r.pct_orquestados) + ' del universo activo', null, 'orquestados');
  }

  /* ------------------------------------------------------- KPI -> lista */
  // Identificados, Huerfanos, Activos y Completamente orquestados son
  // entradas de la lista de jobs (Calc.LISTA, con el mismo predicado con el
  // que se cuentan): un clic abre la lista con ese "Mostrar", otro clic en
  // la misma la devuelve a "Todos", y Universo es "Todos". El estado sigue
  // siendo lista.ind, el del <select>: SeleccionKpi pone la mecanica, asi
  // que elegir en el desplegable tambien mueve la marca. Las cifras no
  // cambian con el clic: siguen siendo las de los filtros de arriba.
  // Registro completo es un porcentaje: no abre nada.
  var KPI_TODOS = 'universo';
  var KPI_LISTA = ['identificados', 'huerfanos', 'activos', 'orquestados'];
  var SK = window.SeleccionKpi;
  var seleccion = SK ? new SK({ valida: function (k) { return KPI_LISTA.indexOf(k) >= 0; }, limpian: [KPI_TODOS] }) : null;
  function marcarDesdeLista() {
    if (seleccion) seleccion.clave = KPI_LISTA.indexOf(lista.ind) >= 0 ? lista.ind : '';
  }
  if (SK) SK.escuchar([$('kpis')], 'data-indicador', function (k) {
    if (!vista) return;
    marcarDesdeLista();
    // Con la lista cerrada el clic la abre con esa tarjeta, nunca la quita.
    if ($('lista').hidden) seleccion.clave = '';
    seleccion.alternar(k);
    lista.ind = seleccion.clave; $('ind').value = lista.ind; lista.tope = 200;
    pintarKpis();
    SK.enfocar([$('kpis')], 'data-indicador', k);
    abrirLista();
  });

  function pintarIngreso() {
    var r = vista.ind;
    $('ingreso').innerHTML = '<div class="orq-cifras">' +
      cifra('Candidatos a migrar a Control-M', n0(r.candidatos), '¿Es candidato? = Si') +
      cifra('Migrados con éxito', n0(r.migrados_exito), 'candidatos ya activos en Control-M') +
      cifra('Avance', pct(r.pct_ingreso) + ' ' + medidor(r.pct_ingreso), null) + '</div>';
    $('decomisos').innerHTML = '<div class="orq-cifras">' +
      cifra('Candidatos a decomiso', n0(r.decomisos), 'renglones de la hoja Decomisos') +
      cifra('Decomisados exitosos', n0(r.decomisos_exitosos), 'columna «Exitoso»') +
      cifra('Avance', pct(r.pct_decomisos) + ' ' + medidor(r.pct_decomisos), null) + '</div>';
    $('ejecuciones').innerHTML = '<div class="orq-cifras">' +
      (r.ejec_capturada != null
        ? cifra('Consumidas al día de hoy (capturada en el Excel)', n0(r.ejec_capturada),
            'Calculada por la base: ' + n0(r.ejec_calculada) + ' (promedio diario de los activos)')
        : cifra('Consumidas al día (calculada por la base)', n0(r.ejec_calculada),
            vista.filtrado ? 'La capturada en el Excel es solo del total.' : 'Promedio diario de los activos')) +
      cifra('Pendientes por migrar', n0(r.pend_migrar), 'promedio diario de los candidatos (Si) que están N/A en Control-M') +
      '</div>';
  }

  function pintarMadurez() {
    var filas = vista.madurez.map(function (m) {
      return '<tr><td>' + esc(m.nombre) + '</td><td class="n">' + n0(m.universo) + '</td><td class="n">' + n0(m.logrado) +
        '</td><td class="n">' + pct(m.pct) + ' ' + medidor(m.pct) + '</td></tr>';
    }).join('');
    $('t-madurez').innerHTML = '<thead><tr><th scope="col">Medidor</th><th scope="col" class="n">Universo</th>' +
      '<th scope="col" class="n">Logrado</th><th scope="col" class="n">%</th></tr></thead><tbody>' + filas + '</tbody>';
  }

  function filaDir(g, clase, extra) {
    return '<tr class="' + clase + '">' + extra +
      '<td class="n">' + n0(g.jobs) + '</td><td class="n">' + pct1(g.pct_universo) + '</td>' +
      '<td class="n">' + n1(g.campos_prom) + '</td><td class="n">' + pct(g.pct_ident) + '</td>' +
      '<td class="n">' + n0(g.red_cand) + '</td><td class="n">' + n0(g.red_exito) + '</td><td class="n">' + pct(g.pct_red) + '</td>' +
      '<td class="n">' + n0(g.dep_cand) + '</td><td class="n">' + n0(g.dep_exito) + '</td><td class="n">' + pct(g.pct_dep) + '</td>' +
      '<td class="n">' + n0(g.nuevo_cand) + '</td><td class="n">' + n0(g.nuevo_orq) + '</td>' +
      '<td class="n">' + n0(g.adopcion) + '</td></tr>';
  }
  function pintarDireccion() {
    var d = vista.dir;
    var cab = '<thead><tr><th scope="col">Dirección / N3</th><th scope="col" class="n">Jobs</th><th scope="col" class="n">% universo</th>' +
      '<th scope="col" class="n">Campos prom. (de 14)</th><th scope="col" class="n">% identificación</th>' +
      '<th scope="col" class="n">Cand. reducción</th><th scope="col" class="n">Reducciones</th><th scope="col" class="n">%</th>' +
      '<th scope="col" class="n">Cand. depuración</th><th scope="col" class="n">Depurados</th><th scope="col" class="n">%</th>' +
      '<th scope="col" class="n">Nuevos a orquestar</th><th scope="col" class="n">Orquestados</th>' +
      '<th scope="col" class="n">En adopción</th></tr></thead>';
    var cuerpo = d.direcciones.map(function (g, i) {
      var abierta = abiertas.has(g.nombre) || !!f.dir;
      var html = filaDir(g, 'dir', '<td><button type="button" class="liga" data-dir="' + i + '" aria-expanded="' + abierta + '">' +
        '<span class="flecha" aria-hidden="true">' + (abierta ? '▾' : '▸') + '</span>' + esc(g.nombre) + '</button></td>');
      if (abierta) {
        html += g.n3s.map(function (n, k) {
          return filaDir(n, 'n3', '<td><button type="button" class="liga" data-dir="' + i + '" data-n3="' + k + '">' + esc(n.nombre) + '</button></td>');
        }).join('');
      }
      return html;
    }).join('');
    $('t-dir').innerHTML = cab + '<tbody>' + (cuerpo || '<tr class="vacia"><td colspan="14">Sin jobs con estos filtros</td></tr>') +
      (d.direcciones.length > 1 ? filaDir(d.total, 'total', '<td>Total</td>') : '') + '</tbody>';
  }
  $('t-dir').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.liga') : null;
    if (!b || !vista) return;
    var g = vista.dir.direcciones[+b.getAttribute('data-dir')];
    if (!g) return;
    if (b.hasAttribute('data-n3')) {
      var n = g.n3s[+b.getAttribute('data-n3')];
      f.dir = g.nombre; f.n3 = n ? n.nombre : '';
      $('dir').value = f.dir; llenarN3(); $('n3').value = f.n3; f.n3 = $('n3').value;
      pintar();
      return;
    }
    if (abiertas.has(g.nombre)) abiertas.delete(g.nombre); else abiertas.add(g.nombre);
    pintarDireccion();
  });

  function pintarCampos() {
    var filas = vista.campos.map(function (c) {
      return '<tr><td>' + esc(c.letra) + '</td><td>' + esc(c.nombre) + '</td><td class="n">' + n0(c.con_dato) +
        '</td><td class="n">' + n0(c.faltantes) + '</td><td class="n">' + pct(c.pct) + '</td><td class="n">' + n0(c.documentados) +
        '</td><td class="n">' + pct(c.pct_doc) + ' ' + medidor(c.pct_doc) + '</td></tr>';
    }).join('');
    $('t-campos').innerHTML = '<thead><tr><th scope="col">Col.</th><th scope="col">Dato requerido</th>' +
      '<th scope="col" class="n">Con dato</th><th scope="col" class="n">Faltantes</th><th scope="col" class="n">%</th>' +
      '<th scope="col" class="n">Documentado</th><th scope="col" class="n">%</th></tr></thead><tbody>' + filas + '</tbody>';
  }

  /* ------------------------------------------------------------ graficas */
  function grafica(id, cfg) {
    if (graficas[id]) graficas[id].destroy();
    if (typeof Chart === 'undefined') return null;
    graficas[id] = new Chart($(id), cfg);
    return graficas[id];
  }

  function llenarHistorico() {
    var sel = $('h-ind');
    sel.innerHTML = Calc.HISTORICO.map(function (h) {
      return '<option value="' + esc(h.id) + '">' + esc(h.nombre) + '</option>';
    }).join('');
    sel.value = 'MigradosNuevos';
    sel.onchange = pintarHistorico;
    pintarHistorico();
  }
  function pintarHistorico() {
    var id = $('h-ind').value;
    var s = Calc.historico(historicoFilas, id);
    grafica('g-historico', {
      type: 'line',
      data: {
        labels: s.fechas.map(diaCorto),
        datasets: [
          { label: 'Excel', data: s.excel, borderColor: '#65bb2b', backgroundColor: '#65bb2b', pointRadius: 2, spanGaps: true, tension: 0.15 },
          { label: 'Base', data: s.base, borderColor: '#d97706', backgroundColor: '#d97706', pointRadius: 4, borderDash: [5, 4], spanGaps: true },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' },
                   tooltip: { callbacks: { label: function (c) { return c.dataset.label + ': ' + n0(c.raw); } } } },
        scales: { y: { beginAtZero: false, ticks: { precision: 0, callback: function (v) { return n0(v); } } } },
      },
    });
  }

  // La vista del tablero anterior: las mismas tarjetas y graficas, con datos
  // de la base y los filtros de arriba. Clasificacion es severidad: su escala
  // de estado (rojo -> ambar -> verde, neutro para Unica) no sale de la paleta.
  var COLOR_CLASIF = ['#982a18', '#d97706', '#356b2c', '#8a8578', '#c9ccc4'];
  function pastel(id, idLeyenda, entradas, registro) {
    var labels = entradas.map(function (e) { return e[0]; });
    var data = entradas.map(function (e) { return e[1]; });
    var colores = window.Paleta ? Paleta.registro(registro).escala(labels) : labels.map(function () { return '#65bb2b'; });
    grafica(id, {
      type: 'pie',
      data: { labels: labels, datasets: [{ data: data, backgroundColor: colores, borderWidth: 2, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false },
        tooltip: { callbacks: { label: function (c) { return c.label + ': ' + n0(c.raw); } } } } },
    });
    $(idLeyenda).innerHTML = labels.map(function (l, i) {
      return '<span><i style="background:' + esc(colores[i]) + '"></i>' + esc(l) + ': ' + n0(data[i]) + '</span>';
    }).join('');
  }
  function pintarV37() {
    var r = vista.v37;
    $('kpis37').innerHTML =
      tarjeta('Cantidad de jobs', n0(r.n_jobs), 'jobs analizados', null) +
      tarjeta('Cantidad de tareas', n0(r.n_tareas), 'suma del promedio diario', null) +
      tarjeta('% Migrados', pct(r.pct_migrados), n0(r.migrados) + ' de ' + n0(r.n_jobs) + ' (¿Es candidato? = Migrados)', null) +
      tarjeta('Nivel de completitud', pct(r.completitud), 'campos W–AJ con dato', null) +
      tarjeta('Jobs no candidatos', n0(r.no_candidatos), '¿Es candidato? = No', null) +
      tarjeta('Jobs a decomisar', n0(r.a_decomisar), '¿Es candidato? = Para decomiso', null);

    var cl = r.por_clasif;
    if (window.Barras) Barras.aplicarDefaults();
    grafica('g-clasif', {
      type: 'bar',
      data: { labels: cl.map(function (e) { return e[0]; }), datasets: [{ data: cl.map(function (e) { return e[1]; }), backgroundColor: COLOR_CLASIF }] },
      options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: function (c) { return n0(c.raw) + ' jobs'; } } } },
        scales: { x: { beginAtZero: true, ticks: { callback: function (v) { return n0(v); } } } } },
      plugins: window.Barras ? [Barras.etiquetasDentro(n0)] : [],
    });
    $('l-clasif').innerHTML = cl.map(function (e, i) {
      return '<span><i style="background:' + COLOR_CLASIF[i] + '"></i>' + esc(e[0]) + ': ' + n0(e[1]) + '</span>';
    }).join('');
    pastel('g-herr', 'l-herr', r.por_herramienta, 'orq-herramienta');
    pastel('g-cand', 'l-cand', r.por_candidato, 'orq-candidato');

    $('t-dir37').innerHTML = '<thead><tr><th scope="col">Dirección</th><th scope="col" class="n">Jobs</th>' +
      '<th scope="col" class="n">Tareas</th><th scope="col" class="n">% Migr.</th><th scope="col" class="n">Complet.</th></tr></thead><tbody>' +
      (r.por_dir.map(function (d) {
        return '<tr><td><b>' + esc(d.dir) + '</b></td><td class="n">' + n0(d.n_jobs) + '</td><td class="n">' + n0(d.n_tareas) +
          '</td><td class="n">' + pct(d.pct_migrados) + '</td><td class="n">' + pct(d.completitud) + '</td></tr>';
      }).join('') || '<tr class="vacia"><td colspan="5">Sin datos</td></tr>') + '</tbody>';
  }

  /* ------------------------------------------------------------ la lista */
  function traerDetalle() {
    if (detalle) return Promise.resolve(detalle);
    return pedir(API + '?detalle=1').then(function (j) {
      detalle = new Map();
      Calc.tabla(j.detalle).forEach(function (d) { detalle.set(d.JobId, d); });
      return detalle;
    });
  }
  $('ind').innerHTML = Calc.LISTA.map(function (l) { return '<option value="' + esc(l.id) + '">' + esc(l.nombre) + '</option>'; }).join('');
  $('ind').onchange = function () { lista.ind = this.value; lista.tope = 200; if (vista) pintarKpis(); pintarLista(); };
  $('buscar').oninput = function () { lista.texto = this.value; lista.tope = 200; pintarLista(); };
  $('mas').onclick = function () { lista.tope += 200; pintarLista(); };
  $('ver-jobs').onclick = function () {
    if (!$('lista').hidden) { $('lista').hidden = true; this.textContent = 'Ver la lista'; return; }
    abrirLista();
  };
  // La abre el boton y la abre el clic en una tarjeta (KPI -> lista). Ya
  // abierta, solo se repinta.
  function abrirLista() {
    var b = $('ver-jobs');
    if (!$('lista').hidden) { pintarLista(); return; }
    if (b.disabled) return;   // ya va en camino
    b.disabled = true; b.textContent = 'Cargando…';
    traerDetalle().then(function () {
      $('lista').hidden = false; b.textContent = 'Ocultar la lista'; pintarLista();
    }).catch(function (e) {
      b.textContent = 'Ver la lista';
      error('No se pudo traer la lista de jobs: ' + (e && e.message ? e.message : e));
    }).then(function () { b.disabled = false; });
  }
  function pintarLista() {
    if (!detalle || !vista) return;
    var filas = Calc.lista(vista.jobs, detalle, lista.ind, lista.texto);
    $('conteo').textContent = n0(filas.length) + ' jobs' + (filas.length > lista.tope ? ' · se muestran ' + n0(lista.tope) : '');
    var html = filas.slice(0, lista.tope).map(function (x) {
      var d = x.det, o = x.job;
      return '<tr><td class="largo"><b>' + esc(d.JobName) + '</b><div class="sub">renglón ' + n0(d.FilaExcel) + '</div></td>' +
        '<td>' + esc(d.Herramienta) + '</td><td>' + esc(d.EstatusControlM) + '</td><td>' + esc(d.EsCandidato) + '</td>' +
        '<td class="n">' + (d.PromedioDiarioTexto ? esc(d.PromedioDiarioTexto) : n1(d.PromedioDiario)) + '</td>' +
        '<td>' + esc(d.EsquemaConsiderado) + '</td><td class="largo">' + esc(d.Aplicacion) +
        (d.AplicacionEnCatalogo === 0 ? '<div class="orq-adv">fuera del catálogo</div>' : '') + '</td>' +
        '<td class="largo">' + esc(o.Dir) + '<div class="sub">' + esc(o.N3) + '</div></td>' +
        '<td class="n">' + n0(o.CamposLlenosExcel) + ' / ' + n0(o.CamposLlenosEstricta) + '</td>' +
        '<td class="largo">' + (d.Advertencias ? '<span class="orq-adv">' + esc(d.Advertencias) + '</span>' : '') +
        (d.PersonasFueraDeDatos > 0 ? '<div class="orq-adv">' + n0(d.PersonasFueraDeDatos) + ' responsable(s) fuera de Datos</div>' : '') + '</td></tr>';
    }).join('');
    $('t-jobs').innerHTML = '<thead><tr><th scope="col">Job</th><th scope="col">Herramienta</th><th scope="col">Control-M</th>' +
      '<th scope="col">¿Es candidato?</th><th scope="col" class="n">Prom. diario</th><th scope="col">Esquema</th>' +
      '<th scope="col">Aplicación</th><th scope="col">Dirección / N3</th><th scope="col" class="n">Campos (Excel / doc.)</th>' +
      '<th scope="col">Advertencias</th></tr></thead><tbody>' +
      (html || '<tr class="vacia"><td colspan="10">Ningún job con estos filtros</td></tr>') + '</tbody>';
    $('mas').hidden = filas.length <= lista.tope;
  }

  /* ------------------------------------------------------------ la carga */
  function pintarCarga() {
    var c = datos.carga || {};
    var tipos = (c.advertencias_por_tipo || []).map(function (t) {
      return '<tr><td>' + esc(t.hoja) + '</td><td>' + esc(t.tipo) + '</td><td class="n">' + n0(t.cuantas) + '</td></tr>';
    }).join('');
    $('carga-cuerpo').innerHTML = '<p class="nota">Carga ' + n0(c.numero) + ' del ' + esc(dia(c.fecha)) + ' (' + esc(c.archivo) + '): ' +
      n0(c.jobs_en_excel) + ' jobs en el Excel, ' + n0(c.jobs_nuevos) + ' nuevos, ' + n0(c.jobs_cambiados) + ' cambiados, ' +
      n0(c.jobs_baja) + ' que ya no vienen. El detalle de cada advertencia está en <code>orq.Advertencia</code>.</p>' +
      '<div class="orq-tabla-wrap orq-carga-tabla"><table class="orq-tabla"><thead><tr><th scope="col">Hoja</th><th scope="col">Advertencia</th>' +
      '<th scope="col" class="n">Cuántas</th></tr></thead><tbody>' +
      (tipos || '<tr class="vacia"><td colspan="3">Ninguna</td></tr>') + '</tbody></table></div>';
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
    if (anchos) ws['!cols'] = anchos.map(function (w) { return { wch: w }; });
    return ws;
  }
  $('excel').onclick = function () {
    var b = this;
    b.disabled = true;
    Promise.all([cargarXlsx(), traerDetalle()]).then(function (r) {
      var XLSX = r[0], v = vista, i = v.ind;
      var wb = XLSX.utils.book_new();
      var filtros = [['Dirección', f.dir || 'Todas'], ['N3', f.n3 || 'Todos'], ['Herramienta', f.herr || 'Todas'],
                     ['¿Es candidato?', f.cand.length ? f.cand.join(', ') : 'Todos']];
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, [['Orquestación', ''], ['Carga del Excel', (datos.carga || {}).fecha || '']]
        .concat(filtros).concat([[], ['Indicador', 'Valor'],
          ['Universo de jobs', i.universo], ['Identificados', i.identificados], ['Huérfanos', i.huerfanos],
          ['Registro completo (con dato)', i.completitud], ['Registro completo (documentado)', i.estricta],
          ['Jobs documentados al 100%', i.completos], ['Activos en Control-M', i.activos],
          ['Completamente orquestados', i.orquestados], ['% del universo activo', i.pct_orquestados],
          ['Candidatos a migrar (Si)', i.candidatos], ['Migrados con éxito', i.migrados_exito], ['% avance', i.pct_ingreso],
          ['Candidatos a decomiso', i.decomisos], ['Decomisados exitosos', i.decomisos_exitosos], ['% avance decomisos', i.pct_decomisos],
          ['Ejecuciones consumidas (capturada)', i.ejec_capturada], ['Ejecuciones consumidas (calculada)', i.ejec_calculada],
          ['Ejecuciones pendientes por migrar', i.pend_migrar],
          ['Ejecuciones (consumidas + pendientes)', i.ejec_futuras]]), [42, 20]), 'Resumen');
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, [['Medidor', 'Universo', 'Logrado', '%']].concat(v.madurez.map(function (m) {
        return [m.nombre, m.universo, m.logrado, m.pct];
      })), [22, 10, 10, 8]), 'Madurez');
      var dn = [['Dirección', 'N3', 'Jobs', '% universo', 'Campos prom.', '% identificación', 'Cand. reducción', 'Reducciones',
                 '% reducción', 'Cand. depuración', 'Depurados', '% depuración', 'Nuevos a orquestar', 'Orquestados', 'En adopción']];
      function fila(dir, n3, g) {
        return [dir, n3, g.jobs, g.pct_universo, g.campos_prom, g.pct_ident, g.red_cand, g.red_exito, g.pct_red,
                g.dep_cand, g.dep_exito, g.pct_dep, g.nuevo_cand, g.nuevo_orq, g.adopcion];
      }
      v.dir.direcciones.forEach(function (g) {
        dn.push(fila(g.nombre, 'Total dirección', g));
        g.n3s.forEach(function (n) { dn.push(fila(g.nombre, n.nombre, n)); });
      });
      dn.push(fila('Total', '', v.dir.total));
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, dn, [30, 30, 8, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10]), 'Dirección - N3');
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, [['Col.', 'Dato requerido', 'Con dato', 'Faltantes', '%', 'Documentado', '% documentado']]
        .concat(v.campos.map(function (c) { return [c.letra, c.nombre, c.con_dato, c.faltantes, c.pct, c.documentados, c.pct_doc]; })),
        [6, 36, 10, 10, 8, 12, 12]), 'Completitud por campo');
      var v7 = v.v37, h37 = [['Cantidad de jobs', v7.n_jobs], ['Cantidad de tareas', v7.n_tareas], ['% Migrados', v7.pct_migrados],
        ['Nivel de completitud', v7.completitud], ['Jobs no candidatos', v7.no_candidatos], ['Jobs a decomisar', v7.a_decomisar], [],
        ['Clasificación', 'Jobs']].concat(v7.por_clasif).concat([[], ['Herramienta', 'Jobs']]).concat(v7.por_herramienta)
        .concat([[], ['¿Es candidato?', 'Jobs']]).concat(v7.por_candidato)
        .concat([[], ['Dirección', 'Jobs', 'Tareas', '% Migrados', 'Completitud']])
        .concat(v7.por_dir.map(function (d) { return [d.dir, d.n_jobs, d.n_tareas, d.pct_migrados, d.completitud]; }));
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, h37, [30, 10, 10, 12, 12]), 'Vista v3.7');
      var hc = ['Fecha', 'Origen'].concat(Calc.HISTORICO.map(function (x) { return x.nombre; }));
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, [hc].concat(historicoFilas.map(function (h) {
        return [h.Fecha, h.Origen].concat(Calc.HISTORICO.map(function (x) { return h[x.id]; }));
      })), [11, 8, 12, 12, 12, 12, 12, 12, 12, 12, 12]), 'Histórico');
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, [['Job', 'Dirección', 'N3', '¿Es candidato?', 'Resultado', 'Estatus', 'Estado CAB',
        'Fecha compromiso', 'Fecha real']].concat(v.decomisos.map(function (d) {
          return [d.JobName, d.Dir, d.N3, d.Candidato, d.Resultado, d.EstatusDecomiso, d.EstadoCAB, d.FechaCompromiso, d.FechaReal];
        })), [34, 26, 26, 16, 10, 14, 14, 12, 12]), 'Decomisos');
      var jc = [['Job', 'Renglón del Excel', 'Herramienta', 'Estatus control-M', '¿Es candidato?', 'Promedio diario', 'Clasificación',
                 'Esquema', 'Aplicación', 'Aplicación en catálogo', 'Dirección', 'N3', 'Service Owner N2', 'Escalación 1', 'Escalación 2',
                 'Escalación 3', 'Criticidad', 'Proceso de negocio', 'Campos con dato', 'Campos documentados', 'Huérfano',
                 'Activo', 'Completamente orquestado', 'Migrado', 'Optimizado', 'Con alertamiento', 'Sin redundancia',
                 'Con SLA activo', 'Nombre del SLA', 'Responsables fuera de Datos', 'Advertencias']];
      Calc.lista(v.jobs, detalle, '', '').forEach(function (x) {
        var d = x.det, o = x.job;
        jc.push([d.JobName, d.FilaExcel, d.Herramienta, d.EstatusControlM, d.EsCandidato,
                 d.PromedioDiarioTexto || d.PromedioDiario, d.Clasificacion, d.EsquemaConsiderado, d.Aplicacion,
                 d.AplicacionEnCatalogo === 1 ? 'Si' : (d.AplicacionEnCatalogo === 0 ? 'No' : ''), o.Dir, o.N3, d.ServiceOwnerN2,
                 d.Escalacion1, d.Escalacion2, d.Escalacion3, d.Criticidad, d.ProcesoNegocio, o.CamposLlenosExcel,
                 o.CamposLlenosEstricta, o.EsHuerfano ? 'Si' : 'No', o.Activo ? 'Si' : 'No', o.OrqCompleto ? 'Si' : 'No',
                 d.Migrado, d.Optimizado, d.ConAlertamiento, d.SinRedundancia, d.ConSlaActivo, d.NombreSla,
                 d.PersonasFueraDeDatos, d.Advertencias]);
      });
      XLSX.utils.book_append_sheet(wb, hoja(XLSX, jc, [34, 8, 16, 12, 16, 10, 14, 10, 24, 10, 26, 26, 26, 22, 22, 22, 10, 22,
                                                       8, 8, 8, 8, 8, 10, 10, 10, 12, 10, 20, 8, 40]), 'Jobs');
      XLSX.writeFile(wb, 'Orquestacion_' + (datos.hoy || '') + (Calc.hayFiltro(f) ? '_filtrado' : '') + '.xlsx');
    }).catch(function (e2) {
      error('No se pudo armar el Excel: ' + (e2 && e2.message ? e2.message : e2));
    }).then(function () { b.disabled = false; });
  };

  /* ------------------------------------------------------------ tablero */
  window.TableroOrquestacionModulo = {
    // Las graficas que se pintaron con la pestaña oculta midieron cero.
    redimensionar: function () {
      Object.keys(graficas).forEach(function (k) { if (graficas[k]) graficas[k].resize(); });
    },
  };

  cargar();
})();
