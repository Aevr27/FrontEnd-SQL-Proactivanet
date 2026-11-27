/* =========================================================================
   tecnicos/tecnicos.js

   Pestaña Tecnicos (calidad de la respuesta abierta QARE por tecnico). Un
   solo archivo para la pagina suelta (tecnicos/tecnicos.html) y para la
   pestaña del tablero, que monta ese mismo marcado e inyecta este mismo
   script (TableroTecnicos en dashboard.js). Modulo INDEPENDIENTE de QA y de
   QARE: otros procedimientos, otro handler, otro contrato.

   Todo sale de handlers/tecnicos.ashx en UNA peticion por rango de fechas,
   que lee los cuatro SP del prototipo de Daniela:
     KPIs                 usp_QARE_CalidadCaptura_KPIs
     Barra / Pareto       usp_QARE_PatronesSolucion (result sets 3 y 2)
     Tabla por tecnico    usp_QARE_CalidadCaptura_Tecnicos
     Evidencia            usp_QARE_DetalleEvidencia

   Regla de datos: aqui no se calcula ni se clasifica nada. Totales,
   porcentajes, el acumulado del Pareto, los estados y las clasificaciones son
   los de SQL, tal como llegan; un NULL se muestra como "—", no como cero. Lo
   unico que se hace aqui es formatear, ordenar visualmente lo ya recibido
   (nada) y buscar / filtrar / paginar la tabla de evidencia que ya llego.

   TipoClasificacionRespuesta (sql/47): se muestra solo si el Detalle la trae
   (detalleTraeTipo). Si no, la columna no aparece y no se deduce de los
   nombres de ClasificacionRespuesta.

   Dos partes:
     1. TecnicosDatos: funciones PURAS (sin DOM), en window.TecnicosDatos para
        tools/tests/TecnicosVistaSmoke.js.
     2. El tablero: peticion y pintado. Solo corre con documento y marcado.
   ========================================================================= */

(function (raiz) {
  'use strict';

  // ================================================================ 1. puro

  var NUM = new Intl.NumberFormat('es-MX');
  var NUM2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  var NULO = '—';

  // Numero finito o null. Un NULL de SQL se queda en null: no es un cero.
  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function entero(v) {
    var n = numero(v);
    return n === null ? NULO : NUM.format(n);
  }

  // El porcentaje tal como lo manda el SP (escala 0-100, dos decimales).
  function pct(v) {
    var n = numero(v);
    return n === null ? NULO : NUM2.format(n) + ' %';
  }

  function texto(v) {
    if (v === null || v === undefined) return '';
    return String(v);
  }

  // Sin acentos, sin mayusculas y sin espacios de sobra: solo para BUSCAR.
  function normal(t) {
    return texto(t).normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* "Hoy" en Mexico con el mismo reloj que el servidor (UTC-6 fijo,
     DashboardDataInfo.HoyEnPresentacion). */
  var MS_DIA = 864e5;
  var DESFASE_MEXICO = 6 * 36e5;
  function diaMexico(ms) { return Math.floor((ms - DESFASE_MEXICO) / MS_DIA); }
  function isoDia(n) { return new Date(n * MS_DIA).toISOString().slice(0, 10); }

  // Los `dias` dias naturales que terminan HOY, incluido.
  function rangoRapido(dias, ahoraMs) {
    var fin = diaMexico(ahoraMs);
    return { inicio: isoDia(fin - (dias - 1)), fin: isoDia(fin) };
  }

  // Mismo tope que TecnicosContrato.DiasMaximos (el handler lo vuelve a revisar).
  var DIAS_MAXIMOS = 93;

  /* null si el rango sirve; si no, el mensaje. Se revisa antes de pedir para
     no mandar un rango que el servidor va a rechazar. */
  function validarRango(fi, ff) {
    var re = /^\d{4}-\d{2}-\d{2}$/;
    if (!fi || !ff) return 'Elige la fecha inicio y la fecha fin.';
    if (!re.test(fi) || !re.test(ff)) return 'Las fechas deben tener el formato aaaa-mm-dd.';
    if (fi > ff) return 'Rango de fechas invalido: la fecha inicio debe ser anterior o igual a la fecha fin.';
    var dias = Math.round((Date.parse(ff + 'T00:00:00Z') - Date.parse(fi + 'T00:00:00Z')) / MS_DIA) + 1;
    if (dias > DIAS_MAXIMOS) return 'El rango es demasiado largo: el maximo es de ' + DIAS_MAXIMOS + ' dias.';
    return null;
  }

  // Query string de tecnicos.ashx: SIEMPRE las dos fechas.
  function consulta(fi, ff) {
    return 'fecha_inicio=' + encodeURIComponent(fi) + '&fecha_fin=' + encodeURIComponent(ff);
  }

  /* Las cuatro tarjetas, con los campos de usp_QARE_CalidadCaptura_KPIs:
     [titulo, campo del valor, campo del % (o null), pie]. El % de
     analizables e invalidas es el del SP, sobre los evaluados. */
  var KPIS = [
    ['Total de tickets', 'TicketsTotales', null, 'Tickets firmados en el periodo'],
    ['Sin información QARE', 'TicketsSinInformacionQARE', null, 'Sin respuesta abierta capturada'],
    ['Respuestas analizables', 'TicketsTextoEvaluable', 'PctTextoEvaluable', 'de los evaluados'],
    ['Respuestas inválidas', 'TicketsNoEvaluables', 'PctNoEvaluable', 'de los evaluados'],
  ];

  function tarjetasKpi(k) {
    return KPIS.map(function (d) {
      if (!k) return { titulo: d[0], valor: NULO, pie: '' };
      var pie = d[2] ? pct(k[d[2]]) + ' ' + d[3] : d[3];
      return { titulo: d[0], valor: entero(k[d[1]]), pie: pie };
    });
  }

  /* La barra segmentada: result set 3 de usp_QARE_PatronesSolucion. Los
     anchos son los Pct* del SP tal cual; un Pct NULL deja el segmento sin
     ancho y su leyenda en "—". No se normaliza a 100. */
  var SEGMENTOS = [
    ['patron', 'Patrón reconocido', 'TicketsConPatron', 'PctConPatron'],
    ['calidad', 'Respuesta incompleta', 'TicketsCalidad', 'PctCalidad'],
    ['sin', 'Sin patrón identificado', 'TicketsSinPatron', 'PctSinPatron'],
  ];

  function segmentos(resumen) {
    return SEGMENTOS.map(function (s) {
      var p = resumen ? numero(resumen[s[3]]) : null;
      return {
        clave: s[0], etiqueta: s[1],
        tickets: resumen ? entero(resumen[s[2]]) : NULO,
        pct: p === null ? NULO : pct(p),
        ancho: p === null ? 0 : Math.max(0, Math.min(100, p)),
      };
    });
  }

  /* Columnas de la tabla por tecnico: la firma y las cinco metricas que
     Daniela resalto, cada una con su % del SP; mas total y sin informacion.
     [clave, encabezado, campo, campo %]. */
  var COLUMNAS_TECNICOS = [
    ['firma', 'Técnico (firma de solución)', 'FirmaSolucion', null],
    ['total', 'Tickets', 'TicketsTotales', null],
    ['sinInfo', 'Sin información QARE', 'TicketsSinInformacionQARE', null],
    ['invalidas', 'Respuestas inválidas', 'TicketsNoEvaluables', 'PctNoEvaluable'],
    ['analizables', 'Respuestas analizables', 'TicketsTextoEvaluable', 'PctTextoEvaluable'],
    ['patron', 'Patrón reconocido', 'TicketsConPatron', 'PctConPatron'],
    ['calidad', 'Respuesta incompleta', 'TicketsCalidad', 'PctCalidad'],
    ['sin', 'Sin patrón identificado', 'TicketsSinPatron', 'PctSinPatron'],
  ];

  function celdasTecnico(f) {
    return COLUMNAS_TECNICOS.map(function (c) {
      if (c[0] === 'firma') return { clave: c[0], valor: f[c[2]] == null ? '(sin firma)' : texto(f[c[2]]) };
      return { clave: c[0], valor: entero(f[c[2]]), pct: c[3] ? pct(f[c[3]]) : null };
    });
  }

  // ---- Evidencia: buscar, filtrar y paginar lo que ya llego ----

  // Columnas donde busca el cuadro de texto.
  var CAMPOS_BUSQUEDA = ['CodigoTicket', 'QARe_DescripcionSolucion', 'FirmaSolucion',
    'ClasificacionRespuesta', 'QARe_TipoSolucion', 'QARe_Causa', 'Grupo', 'Categoria'];

  /* Los estados visuales que trajo el Detalle, en orden de aparicion. Son
     las etiquetas del SP (EstadoDescripcionVisual); no hay lista fija. */
  function estadosDe(filas) {
    var vistos = {}, salida = [];
    (filas || []).forEach(function (f) {
      var e = texto(f.EstadoDescripcionVisual);
      if (!vistos[e]) { vistos[e] = true; salida.push(e); }
    });
    return salida;
  }

  /* Filtro de la tabla, sobre las filas recibidas. `estado` compara con
     EstadoDescripcionVisual tal cual; `firma` con FirmaSolucion tal cual;
     `buscar` es texto libre sin acentos ni mayusculas. */
  function filtrarDetalle(filas, f) {
    f = f || {};
    var q = normal(f.buscar);
    return (filas || []).filter(function (fila) {
      if (f.estado && texto(fila.EstadoDescripcionVisual) !== f.estado) return false;
      if (f.firma !== undefined && f.firma !== null && texto(fila.FirmaSolucion) !== f.firma) return false;
      if (!q) return true;
      return CAMPOS_BUSQUEDA.some(function (c) { return normal(fila[c]).indexOf(q) !== -1; });
    });
  }

  function paginar(filas, pagina, tamano) {
    var total = (filas || []).length;
    tamano = Math.max(1, tamano | 0);
    var paginas = Math.max(1, Math.ceil(total / tamano));
    pagina = Math.min(Math.max(1, pagina | 0), paginas);
    var ini = (pagina - 1) * tamano;
    var trozo = (filas || []).slice(ini, ini + tamano);
    return {
      filas: trozo, pagina: pagina, paginas: paginas, total: total,
      desde: total === 0 ? 0 : ini + 1, hasta: ini + trozo.length,
    };
  }

  /* Color de la etiqueta de estado: SOLO las tres etiquetas que devuelve el
     SP. No clasifica: un valor que no sea ninguna queda neutro. */
  function claseEstado(visual) {
    switch (texto(visual)) {
      case 'RESPUESTA ANALIZABLE': return 'ana';
      case 'RESPUESTA INVALIDA': return 'inv';
      case 'SIN INFORMACION QARE': return 'sin';
      default: return '';
    }
  }

  // Los tres valores de TipoClasificacionRespuesta (sql/47), tal como vienen.
  function claseTipo(tipo) {
    switch (texto(tipo)) {
      case 'PATRON_SOLUCION': return 'patron';
      case 'CALIDAD': return 'calidad';
      case 'SIN PATRON': return 'sin';
      default: return '';
    }
  }

  // "2026-11-26T15:39:42" -> "2026-11-26 15:39". Solo formato.
  function fechaHora(v) {
    var t = texto(v);
    return t.length >= 16 ? t.slice(0, 10) + ' ' + t.slice(11, 16) : t;
  }

  /* Parte un texto largo en lineas de hasta `ancho` caracteres (etiquetas
     del Pareto: Chart.js pinta un arreglo de lineas). */
  function partirEtiqueta(t, ancho) {
    var palabras = texto(t).split(/\s+/).filter(Boolean);
    var lineas = [], actual = '';
    palabras.forEach(function (p) {
      if (actual && (actual + ' ' + p).length > ancho) { lineas.push(actual); actual = p; }
      else actual = actual ? actual + ' ' + p : p;
    });
    if (actual) lineas.push(actual);
    return lineas.length > 1 ? lineas : (lineas[0] || texto(t));
  }

  var TecnicosDatos = {
    numero: numero, entero: entero, pct: pct, normal: normal, NULO: NULO,
    rangoRapido: rangoRapido, diaMexico: diaMexico, validarRango: validarRango,
    DIAS_MAXIMOS: DIAS_MAXIMOS, consulta: consulta,
    KPIS: KPIS, tarjetasKpi: tarjetasKpi, SEGMENTOS: SEGMENTOS, segmentos: segmentos,
    COLUMNAS_TECNICOS: COLUMNAS_TECNICOS, celdasTecnico: celdasTecnico,
    CAMPOS_BUSQUEDA: CAMPOS_BUSQUEDA, estadosDe: estadosDe, filtrarDetalle: filtrarDetalle,
    paginar: paginar, claseEstado: claseEstado, claseTipo: claseTipo,
    fechaHora: fechaHora, partirEtiqueta: partirEtiqueta,
  };
  raiz.TecnicosDatos = TecnicosDatos;

  // ============================================================ 2. tablero
  if (typeof document === 'undefined') return;

  var API = (function () {
    var yo = document.currentScript && document.currentScript.src;
    try { return new URL('../handlers/tecnicos.ashx', yo).href; }
    catch (e) { return 'handlers/tecnicos.ashx'; }
  })();

  var PREFIJO = 'tec-';
  function $(id) { return document.getElementById(PREFIJO + id); }
  function esc(v) { return Escape.html(v); }

  var DIAS_POR_OMISION = 15;
  var COLOR_ACUMULADO = Paleta.PALETA_CATEGORICA[4];
  var TINTA = { eje: '#5e5e5f', etiqueta: '#393939', rejilla: '#eef1ea' };

  var grafica = null;
  var peticion = 0;

  // Estado de la tabla de evidencia. Vive en memoria; recargar datos lo
  // conserva salvo la pagina, que vuelve a 1.
  var evid = { filas: [], conTipo: false, buscar: '', estado: '', firma: null, pagina: 1, tamano: 25, abiertos: {} };

  // ------------------------------------------------------------- mensajes
  function mensaje(id, txt, esError) {
    var caja = $('msg-' + id);
    if (!caja) return;
    caja.hidden = !txt;
    caja.textContent = txt || '';
    caja.classList.toggle('tec-msg-error', !!esError);
  }

  // ---------------------------------------------------------------- KPIs
  function pintarKpis(k, error) {
    $('kpis').innerHTML = tarjetasKpi(k).map(function (t) {
      return '<div class="kpi"><div class="lbl">' + esc(t.titulo) + '</div>' +
        '<div class="val">' + esc(error ? 'n/d' : t.valor) + '</div>' +
        '<div class="foot">' + esc(error || t.pie) + '</div></div>';
    }).join('');
  }

  // ---------------------------------------------------------------- barra
  function pintarBarra(resumen, error) {
    var barra = $('barra'), leyenda = $('barra-leyenda');
    if (error) {
      barra.innerHTML = ''; leyenda.innerHTML = '';
      mensaje('barra', error, true);
      $('hint-barra').textContent = '';
      return;
    }
    if (!resumen) {
      barra.innerHTML = ''; leyenda.innerHTML = '';
      mensaje('barra', 'Sin respuestas analizables en el rango.');
      $('hint-barra').textContent = '';
      return;
    }
    mensaje('barra', null);
    var segs = segmentos(resumen);
    $('hint-barra').textContent = entero(resumen.TotalTextoEvaluable) + ' respuestas analizables';
    barra.innerHTML = segs.map(function (s) {
      return '<span class="tec-seg tec-seg-' + s.clave + '" style="width:' + s.ancho + '%"' +
        ' title="' + esc(s.etiqueta + ': ' + s.tickets + ' (' + s.pct + ')') + '"></span>';
    }).join('');
    leyenda.innerHTML = segs.map(function (s) {
      return '<span class="tec-ley"><i class="tec-seg-' + s.clave + '"></i>' + esc(s.etiqueta) +
        ' <b>' + esc(s.pct) + '</b> <span class="tec-ley-n">' + esc(s.tickets) + ' tickets</span></span>';
    }).join('');
  }

  // --------------------------------------------------------------- Pareto
  function pintarPareto(filas, error) {
    if (grafica) { grafica.destroy(); grafica = null; }
    if (error) { mensaje('pareto', error, true); $('hint-pareto').textContent = ''; return; }
    if (!filas || !filas.length) { mensaje('pareto', 'Sin patrones reconocidos en el rango.'); $('hint-pareto').textContent = ''; return; }
    mensaje('pareto', null);
    $('hint-pareto').textContent = filas.length + ' patrones · % sobre todos los tickets con patrón';
    var etiquetas = filas.map(function (f) { return texto(f.PatronSolucion); });
    grafica = new DashboardBarChart({
      canvas: $('chart-pareto'),
      etiquetas: etiquetas.map(function (t) { return partirEtiqueta(t, 14); }),
      formato: function (v) { return NUM.format(v); },
      barra: { maxBarThickness: 64 },
      datasets: [
        { type: 'bar', label: 'Tickets', yAxisID: 'y', order: 2, backgroundColor: Paleta.AZUL_SERIE,
          data: filas.map(function (f) { return numero(f.Tickets); }) },
        { type: 'line', label: '% acumulado', yAxisID: 'y2', order: 1,
          data: filas.map(function (f) { return numero(f.PctAcumulado); }),
          borderColor: COLOR_ACUMULADO, backgroundColor: COLOR_ACUMULADO,
          borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0 },
      ],
      opciones: {
        maintainAspectRatio: false,
        layout: { padding: { top: 22, right: 8, left: 8 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 12, color: TINTA.etiqueta, font: { size: 12 } } },
          tooltip: {
            callbacks: {
              title: function (items) { return items.length ? etiquetas[items[0].dataIndex] : ''; },
              label: function (item) {
                var f = filas[item.dataIndex];
                return item.datasetIndex === 0
                  ? entero(f.Tickets) + ' tickets · ' + pct(f.Porcentaje)
                  : 'Acumulado: ' + pct(f.PctAcumulado);
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: TINTA.etiqueta, autoSkip: false, maxRotation: 0, font: { size: 11.5 } }, grid: { display: false } },
          y: { beginAtZero: true, grace: '8%', ticks: { precision: 0, color: TINTA.eje }, grid: { color: TINTA.rejilla },
               title: { display: true, text: 'Tickets', color: TINTA.eje } },
          y2: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false },
                ticks: { color: TINTA.eje, stepSize: 20, callback: function (v) { return v + ' %'; } },
                title: { display: true, text: '% acumulado', color: TINTA.eje } },
        },
      },
    }).render();
  }

  // ------------------------------------------------------- tabla tecnicos
  function pintarTecnicos(filas, error) {
    var cont = $('tabla-tecnicos');
    if (error) { cont.innerHTML = '<div class="vacio tec-vacio-error">' + esc(error) + '</div>'; return; }
    if (!filas || !filas.length) { cont.innerHTML = '<div class="vacio">Sin técnicos en el rango.</div>'; return; }
    $('hint-tecnicos').textContent = filas.length + ' firmas · orden del procedimiento · clic para filtrar la evidencia';
    var html = '<table class="tec-tabla-tec"><thead><tr>' + COLUMNAS_TECNICOS.map(function (c) {
      return '<th scope="col"' + (c[0] === 'firma' ? '' : ' class="num"') + '>' + esc(c[1]) + '</th>';
    }).join('') + '</tr></thead><tbody>';
    filas.forEach(function (f, i) {
      var firma = f.FirmaSolucion == null ? '' : texto(f.FirmaSolucion);
      var activa = evid.firma !== null && evid.firma === firma;
      html += '<tr data-i="' + i + '" tabindex="0" class="' + (activa ? 'tec-fila-activa' : '') + '"' +
        ' aria-pressed="' + activa + '">' +
        celdasTecnico(f).map(function (c) {
          if (c.clave === 'firma') return '<td class="txt">' + esc(c.valor) + '</td>';
          return '<td class="num">' + esc(c.valor) + (c.pct ? '<span class="tec-pct">' + esc(c.pct) + '</span>' : '') + '</td>';
        }).join('') + '</tr>';
    });
    cont.innerHTML = html + '</tbody></table>';
    cont._filas = filas;
  }

  function elegirTecnico(fila) {
    var firma = fila.FirmaSolucion == null ? '' : texto(fila.FirmaSolucion);
    evid.firma = evid.firma === firma ? null : firma;
    evid.pagina = 1;
    pintarTecnicos($('tabla-tecnicos')._filas, null);
    pintarEvidencia();
  }

  // ------------------------------------------------------------ evidencia
  function opcionesEstado() {
    var sel = $('f-estado');
    var previo = evid.estado;
    var estados = estadosDe(evid.filas);
    if (previo && estados.indexOf(previo) === -1) estados.push(previo);
    sel.innerHTML = '<option value="">Todos los estados</option>' + estados.map(function (e) {
      return '<option value="' + esc(e) + '"' + (e === previo ? ' selected' : '') + '>' + esc(e || '(sin estado)') + '</option>';
    }).join('');
  }

  function celda(v, clase) {
    return '<td' + (clase ? ' class="' + clase + '"' : '') + '>' + esc(v == null ? NULO : texto(v)) + '</td>';
  }

  function pintarEvidencia(error) {
    var cont = $('tabla-evidencia');
    var chip = $('chip-firma');
    chip.hidden = evid.firma === null;
    if (evid.firma !== null) $('chip-firma-txt').textContent = 'Técnico: ' + (evid.firma || '(sin firma)');

    if (error) {
      cont.innerHTML = '<div class="vacio tec-vacio-error">' + esc(error) + '</div>';
      $('paginacion-txt').textContent = '';
      $('btn-prev').disabled = $('btn-next').disabled = true;
      return;
    }
    var filtradas = filtrarDetalle(evid.filas, { buscar: evid.buscar, estado: evid.estado, firma: evid.firma });
    var p = paginar(filtradas, evid.pagina, evid.tamano);
    evid.pagina = p.pagina;
    $('paginacion-txt').textContent = p.total === 0 ? '0 tickets'
      : p.desde + '–' + p.hasta + ' de ' + NUM.format(p.total) + ' tickets · página ' + p.pagina + ' de ' + p.paginas;
    $('btn-prev').disabled = p.pagina <= 1;
    $('btn-next').disabled = p.pagina >= p.paginas;

    if (!p.total) {
      cont.innerHTML = '<div class="vacio">' + (evid.filas.length ? 'Ningún ticket coincide con la búsqueda.' : 'Sin tickets en el rango.') + '</div>';
      return;
    }

    var cols = ['', 'Ticket', 'Causa', 'Aplica a otros casos', 'Generar artículo', 'Verificó clasificación',
      'Tipo de solución', 'Descripción de la solución', 'Estado de la respuesta', 'Clasificación'];
    if (evid.conTipo) cols.push('Tipo de clasificación');
    var html = '<table class="tec-tabla-evid"><thead><tr>' + cols.map(function (c, i) {
      return '<th scope="col"' + (i === 0 ? ' class="tec-col-exp"><span class="tec-sr">Detalle</span>' : '>' + esc(c)) + '</th>';
    }).join('') + '</tr></thead><tbody>';

    p.filas.forEach(function (f) {
      var id = texto(f.CodigoTicket);
      var abierto = !!evid.abiertos[id];
      var estado = claseEstado(f.EstadoDescripcionVisual);
      html += '<tr class="tec-fila' + (abierto ? ' tec-abierta' : '') + '">' +
        '<td class="tec-col-exp"><button type="button" class="tec-exp" data-id="' + esc(id) + '" aria-expanded="' + abierto + '"' +
        ' aria-label="' + (abierto ? 'Ocultar' : 'Mostrar') + ' contexto del ticket ' + esc(id) + '">' + (abierto ? '−' : '+') + '</button></td>' +
        celda(f.CodigoTicket, 'tec-ticket') + celda(f.QARe_Causa) + celda(f.QARe_AplicaOtrosCasos) +
        celda(f.QARe_GenerarArticulo) + celda(f.QARe_VerificoClasificacion) + celda(f.QARe_TipoSolucion) +
        celda(f.QARe_DescripcionSolucion, 'tec-desc') +
        '<td><span class="tec-estado' + (estado ? ' tec-estado-' + estado : '') + '">' + esc(f.EstadoDescripcionVisual == null ? NULO : texto(f.EstadoDescripcionVisual)) + '</span></td>' +
        celda(f.ClasificacionRespuesta);
      if (evid.conTipo) {
        var tipo = claseTipo(f.TipoClasificacionRespuesta);
        html += '<td>' + (f.TipoClasificacionRespuesta == null ? NULO
          : '<span class="tec-tipo' + (tipo ? ' tec-tipo-' + tipo : '') + '">' + esc(f.TipoClasificacionRespuesta) + '</span>') + '</td>';
      }
      html += '</tr>';
      if (abierto) {
        html += '<tr class="tec-ctx"><td></td><td colspan="' + (cols.length - 1) + '"><dl class="tec-ctx-lista">' +
          '<div><dt>Fecha de firma de solución</dt><dd>' + esc(fechaHora(f.FechaFirmaSolucion) || NULO) + '</dd></div>' +
          '<div><dt>Técnico (firma)</dt><dd>' + esc(f.FirmaSolucion == null ? NULO : f.FirmaSolucion) + '</dd></div>' +
          '<div><dt>Grupo</dt><dd>' + esc(f.Grupo == null ? NULO : f.Grupo) + '</dd></div>' +
          '<div><dt>Categoría</dt><dd>' + esc(f.Categoria == null ? NULO : f.Categoria) + '</dd></div>' +
          '<div><dt>Validación</dt><dd>' + esc(f.Validacion == null ? NULO : f.Validacion) + '</dd></div>' +
          '<div class="tec-ctx-largo"><dt>Descripción de la solución (completa)</dt><dd>' + esc(f.QARe_DescripcionSolucion == null ? NULO : f.QARe_DescripcionSolucion) + '</dd></div>' +
          '</dl></td></tr>';
      }
    });
    cont.innerHTML = html + '</tbody></table>';
  }

  // ------------------------------------------------------------- peticion
  function pedir(qs) {
    return fetch(API + '?' + qs, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (resp) {
        return resp.text().then(function (t) {
          var datos = null;
          try { datos = t ? JSON.parse(t) : null; } catch (e) { datos = null; }
          if (!resp.ok) {
            throw new Error(datos && typeof datos.error === 'string'
              ? datos.error : 'El servidor respondio con el codigo ' + resp.status + '.');
          }
          if (!datos) throw new Error('La respuesta del servidor llego vacia o con un formato no valido.');
          return datos;
        });
      }, function () {
        throw new Error('No se pudo contactar a tecnicos.ashx. Revisa que el sitio este publicado y en ejecucion.');
      });
  }

  function enEspera() {
    pintarKpis(null);
    mensaje('barra', 'Calculando…');
    mensaje('pareto', 'Calculando…');
    $('tabla-tecnicos').innerHTML = '<div class="vacio">Calculando…</div>';
    $('tabla-evidencia').innerHTML = '<div class="vacio">Calculando…</div>';
    DatosInfo.mensaje($('estado'), 'Cargando…');
  }

  function fallo(err) {
    pintarKpis(null, 'Error al cargar datos');
    pintarBarra(null, 'Error al cargar datos.');
    pintarPareto(null, 'Error al cargar datos.');
    pintarTecnicos(null, 'Error al cargar datos.');
    evid.filas = [];
    pintarEvidencia('Error al cargar datos.');
    DatosInfo.mensaje($('estado'), 'Error al cargar datos: ' + err.message, err.message);
    $('error-msg').textContent = err.message;
    $('error').hidden = false;
    console.error('[Tecnicos]', err);
  }

  function pintar(d, consultado) {
    var e = d.errores || {};
    pintarKpis(d.kpis || null, e.kpis || null);
    pintarBarra(d.resumen || null, e.resumen || null);
    pintarPareto(d.pareto, e.pareto || null);
    pintarTecnicos(d.tecnicos, e.tecnicos || null);

    evid.filas = d.detalle || [];
    evid.conTipo = d.detalleTraeTipo === true;
    evid.pagina = 1;
    evid.abiertos = {};
    opcionesEstado();
    pintarEvidencia(e.detalle || null);

    var fallidos = Object.keys(e);
    DatosInfo.pintar($('estado'), d.dataInfo, fallidos.length ? {
      sufijo: ' · ⚠ sin datos de: ' + fallidos.join(', '),
      titulo: fallidos.map(function (k) { return k + ': ' + e[k]; }).join('\n'),
      consultado: consultado,
    } : { consultado: consultado });
    fallidos.forEach(function (k) { console.error('[Tecnicos ' + k + ']', e[k]); });

    var avisos = d.avisos || [];
    $('avisos').hidden = !avisos.length;
    $('avisos').innerHTML = avisos.map(function (a) { return '<div>' + esc(a) + '</div>'; }).join('');
  }

  /* fondo = refresco (automatico o "Actualizar"): misma consulta, sin
     "Calculando…"; si falla, lo que se ve se queda y la pastilla lo avisa. */
  var enVuelo = 0, cargadoUnaVez = false;
  function cargar(fondo) {
    fondo = fondo === true;
    var fi = $('f-inicio').value, ff = $('f-fin').value;

    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      fallo(new Error('Esta pagina necesita el servidor: abrela desde el sitio publicado en IIS o desde la pestaña Técnicos del tablero.'));
      return Promise.resolve(null);
    }
    var invalido = validarRango(fi, ff);
    if (invalido) {
      if (fondo) return Promise.resolve(null);
      fallo(new Error(invalido));
      return Promise.resolve(null);
    }

    var token = ++peticion;
    if (!fondo) { $('error').hidden = true; enEspera(); }
    enVuelo++;
    return pedir(consulta(fi, ff))
      .then(function (d) {
        if (token !== peticion) return;
        $('error').hidden = true;
        pintar(d, DatosInfo.ahoraLocal());
        cargadoUnaVez = true;
      })
      .catch(function (err) {
        if (token !== peticion) return;
        if (fondo && cargadoUnaVez) {
          DatosInfo.avisoRefresco($('estado'), '⚠ No se pudo actualizar (' +
            DatosInfo.fechaHora(DatosInfo.ahoraLocal()) + '); se muestran los datos anteriores', err.message);
          console.error('[Tecnicos]', err);
        } else {
          fallo(err);
        }
      })
      .then(function () { enVuelo--; return null; });
  }

  function refrescar() {
    if (enVuelo > 0 || !cargadoUnaVez) return Promise.resolve(null);
    return cargar(true);
  }
  function actualizarAhora() {
    if (enVuelo > 0) return Promise.resolve(null);
    return cargar(cargadoUnaVez);
  }
  // Un refresco repinta la evidencia y cerraria las filas abiertas: espera.
  function puedeRefrescar() {
    return Object.keys(evid.abiertos).length === 0;
  }

  // ------------------------------------------------------------- controles
  function marcarRapido(dias) {
    document.querySelectorAll('#tec-filtros [data-dias]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.dias) === dias));
    });
  }

  function ponerRango(dias) {
    var r = rangoRapido(dias, Date.now());
    $('f-inicio').value = r.inicio;
    $('f-fin').value = r.fin;
    marcarRapido(dias);
  }

  var esperaBusqueda = null;
  function conectar() {
    document.querySelectorAll('#tec-filtros [data-dias]').forEach(function (b) {
      b.addEventListener('click', function () { ponerRango(Number(b.dataset.dias)); cargar(); });
    });
    ['f-inicio', 'f-fin'].forEach(function (id) {
      $(id).addEventListener('change', function () { marcarRapido(null); cargar(); });
    });
    $('reintentar').addEventListener('click', function () { cargar(); });
    if (window.RefrescoAuto) RefrescoAuto.cablearBoton($('btn-actualizar'), actualizarAhora);

    $('tabla-tecnicos').addEventListener('click', function (ev) {
      var tr = ev.target.closest && ev.target.closest('tr[data-i]');
      if (tr) elegirTecnico($('tabla-tecnicos')._filas[Number(tr.getAttribute('data-i'))]);
    });
    $('tabla-tecnicos').addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      var tr = ev.target.closest && ev.target.closest('tr[data-i]');
      if (!tr) return;
      ev.preventDefault();
      elegirTecnico($('tabla-tecnicos')._filas[Number(tr.getAttribute('data-i'))]);
    });
    $('chip-firma-quitar').addEventListener('click', function () {
      evid.firma = null; evid.pagina = 1;
      pintarTecnicos($('tabla-tecnicos')._filas, null);
      pintarEvidencia();
    });

    $('f-buscar').addEventListener('input', function () {
      clearTimeout(esperaBusqueda);
      var v = this.value;
      esperaBusqueda = setTimeout(function () { evid.buscar = v; evid.pagina = 1; pintarEvidencia(); }, 200);
    });
    $('f-estado').addEventListener('change', function () { evid.estado = this.value; evid.pagina = 1; pintarEvidencia(); });
    $('f-tamano').addEventListener('change', function () { evid.tamano = Number(this.value) || 25; evid.pagina = 1; pintarEvidencia(); });
    $('btn-prev').addEventListener('click', function () { evid.pagina--; pintarEvidencia(); });
    $('btn-next').addEventListener('click', function () { evid.pagina++; pintarEvidencia(); });
    $('tabla-evidencia').addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('.tec-exp');
      if (!b) return;
      var id = b.getAttribute('data-id');
      if (evid.abiertos[id]) delete evid.abiertos[id]; else evid.abiertos[id] = true;
      pintarEvidencia();
    });
  }

  var arrancado = false;
  function arrancar() {
    if (arrancado || !$('kpis')) return;
    arrancado = true;
    Barras.aplicarDefaults();
    ponerRango(DIAS_POR_OMISION);
    conectar();
    cargar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  /* Lo que el modulo publica hacia fuera, para TableroTecnicos (dashboard.js):
     al volver a la pestaña se remide el Pareto, que midio cero mientras su
     contenedor estuvo oculto. */
  raiz.TableroTecnicosModulo = {
    redimensionar: function () { if (grafica) grafica.resize(); },
    recargar: function () { return cargar(); },
    refrescar: refrescar,
    puedeRefrescar: puedeRefrescar,
  };
})(window);
