/* =========================================================================
   qare/qare.js

   Pestaña QARE. Un solo archivo para la pagina suelta (qare/qare.html) y para
   la pestaña del tablero, que monta ese mismo marcado e inyecta este mismo
   script (TableroQare en dashboard.js).

   Todo sale de handlers/qare.ashx en UNA peticion por rango de fechas. El
   handler ya entrega cada bloque en el orden del contrato (Posicion ASC, y
   Frecuencia en el orden de la guia con su rotulo en FrecuenciaGuia; ver
   App_Code/QareContrato.cs), asi que aqui no se reordena nada: se pinta en
   el orden en que llega. Unica excepcion, de presentacion: Frecuencia se
   pinta en el orden fijo de ORDEN_FRECUENCIA (ver ordenFrecuencia).

   El boton "⬇ Descargar QARE" pide los tickets a handlers/qare_exportar.ashx
   con la MISMA consulta() (rango + c1/grupos/lideres) y arma el .xlsx aqui,
   con SheetJS cargado al pulsar (ver descargar).

   Regla de datos: lo que el API no trae no se calcula aqui. Los porcentajes
   -incluido el acumulado del Pareto- son los del procedimiento, en escala
   0-100 (verificado en la VM); si alguna vez llegaran en 0-1, el handler lo
   avisa en "avisos" en vez de corregirlo a escondidas.

   Validacion QA: los literales reales son OK, Valido, Incorrecto y Sin
   catalogo (sin acentos). claseValidacion compara sin acentos ni mayusculas
   y no reescribe el valor: la matriz muestra el texto tal como vino.

   Dos partes:
     1. QareDatos: funciones PURAS (sin DOM), publicadas en window.QareDatos
        para tools/tests/QareVistaSmoke.js.
     2. El tablero: shell, peticion y pintado. Solo corre si hay documento y
        el marcado de la pestaña esta puesto.
   ========================================================================= */

(function (raiz) {
  'use strict';

  // ================================================================ 1. puro

  var NUM = new Intl.NumberFormat('es-MX');
  var NUM1 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Numero finito o null. Un null de SQL se queda en null: no es un cero.
  function numero(v) {
    if (v === null || v === undefined || v === '') return null;
    var n = Number(v);
    return isFinite(n) ? n : null;
  }

  function entero(v) {
    var n = numero(v);
    return n === null ? 'n/d' : NUM.format(n);
  }

  function pct(v) {
    var n = numero(v);
    return n === null ? 'n/d' : NUM1.format(n) + ' %';
  }

  // Etiqueta de una categoria. Un NULL se muestra como tal, no como "".
  function etiqueta(v) {
    if (v === null || v === undefined) return '(sin valor)';
    var t = String(v).trim();
    return t === '' ? '(vacio)' : t;
  }

  // Sin acentos, sin mayusculas y sin espacios de sobra: solo para COMPARAR.
  function normal(t) {
    return String(t === null || t === undefined ? '' : t)
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /* Semantica de color de la validacion QA (guia visual, seccion 5):
     OK / Valido = verde, Incorrecto = rojo, Sin catalogo = amarillo. Lo que
     no sea ninguno queda neutro con su nombre intacto; no se agrupa. */
  function claseValidacion(texto) {
    var t = normal(texto);
    if (t === 'ok' || t === 'valido') return 'ok';
    if (t === 'incorrecto') return 'mal';
    if (t === 'sin catalogo') return 'sin';
    return null;
  }

  /* Filas del procedimiento -> matriz ConfirmacionUsuario x ValidacionQA.
     Filas y columnas en el orden en que aparecen: el procedimiento decide. Si
     un par llega dos veces se suma (no deberia; asi no se pierde ninguno). */
  function matriz(filas) {
    var nombresF = [], nombresC = [], vistoF = {}, vistoC = {}, celdas = {}, max = 0;
    (filas || []).forEach(function (f) {
      var r = etiqueta(f.ConfirmacionUsuario);
      var c = etiqueta(f.ValidacionQA);
      if (!vistoF[r]) { vistoF[r] = true; nombresF.push(r); celdas[r] = {}; }
      if (!vistoC[c]) { vistoC[c] = true; nombresC.push(c); }
      var cant = numero(f.CantidadTickets);
      var p = numero(f.PorcentajeDelTotal);
      var previa = celdas[r][c];
      if (previa) {
        cant = (previa.cantidad === null && cant === null) ? null : (previa.cantidad || 0) + (cant || 0);
        p = (previa.pct === null && p === null) ? null : (previa.pct || 0) + (p || 0);
      }
      celdas[r][c] = { cantidad: cant, pct: p };
      if (cant !== null && cant > max) max = cant;
    });
    return { filas: nombresF, columnas: nombresC, celdas: celdas, max: max };
  }

  /* Parte un texto largo en lineas de hasta `ancho` caracteres, por palabras.
     La guia pide la categoria COMPLETA, sin truncar: Chart.js pinta un arreglo
     de lineas como etiqueta de varias lineas. */
  function partirEtiqueta(texto, ancho) {
    var palabras = String(texto).split(/\s+/).filter(Boolean);
    var lineas = [], actual = '';
    palabras.forEach(function (p) {
      if (actual && (actual + ' ' + p).length > ancho) { lineas.push(actual); actual = p; }
      else actual = actual ? actual + ' ' + p : p;
    });
    if (actual) lineas.push(actual);
    return lineas.length > 1 ? lineas : (lineas[0] || String(texto));
  }

  /* "Hoy" en Mexico con el MISMO reloj que el servidor: UTC menos 6 horas
     fijas (DashboardDataInfo.HoyEnPresentacion, y los SP con
     DATEADD(HOUR,-6,SYSUTCDATETIME())). No se usa la hora local del
     navegador: una maquina con otra zona abriria el tablero en otro dia. */
  var MS_DIA = 864e5;
  var DESFASE_MEXICO = 6 * 36e5;

  // Dias desde 1970-01-01 del dia de Mexico en el instante `ms`.
  function diaMexico(ms) { return Math.floor((ms - DESFASE_MEXICO) / MS_DIA); }
  function isoDia(n) { return new Date(n * MS_DIA).toISOString().slice(0, 10); }

  /* Los `dias` dias naturales que terminan HOY, incluido: el default de los
     SP QARE (@Ff = hoy, @Fi = @Ff - 14 para 15 dias). `ahoraMs` entra como
     parametro para que la prueba no dependa del reloj. */
  function rangoRapido(dias, ahoraMs) {
    var fin = diaMexico(ahoraMs);
    return { inicio: isoDia(fin - (dias - 1)), fin: isoDia(fin) };
  }

  /* Query string de qare.ashx: el rango de fechas y los filtros del Backlog
     (c1, grupos, lideres) como listas separadas por comas, igual que
     paramsFiltros() de backlog.js. Un filtro vacio no se manda: vacio =
     todos, y asi la peticion sin filtros es la misma de siempre. */
  var FILTROS_ORG = ['c1', 'grupos', 'lideres'];

  function consulta(fi, ff, filtros) {
    var partes = ['fecha_inicio=' + encodeURIComponent(fi), 'fecha_fin=' + encodeURIComponent(ff)];
    FILTROS_ORG.forEach(function (clave) {
      var valores = ((filtros && filtros[clave]) || []).filter(function (v) { return v !== '' && v != null; });
      if (valores.length) partes.push(clave + '=' + encodeURIComponent(valores.join(',')));
    });
    return partes.join('&');
  }

  /* Pie de una tarjeta KPI: "X de Y" con el denominador que manda el SP
     (TicketsConRespuesta*, TicketsConFrecuencia). Cada porcentaje tiene el
     suyo, distinto del total del periodo. No se recalcula nada. */
  function pieKpi(numerador, denominador) {
    var n = numero(numerador), d = numero(denominador);
    if (n === null) return 'sin dato de tickets';
    if (d === null) return NUM.format(n) + ' tickets';
    return NUM.format(n) + ' de ' + NUM.format(d);
  }

  /* Rotulo de una barra de Frecuencia: el de la guia (FrecuenciaGuia, que
     pone QareContrato.NivelesFrecuencia) o, si no cae en ningun nivel, el
     valor tal como vino de SQL. */
  function etiquetaFrecuencia(f) {
    return f && f.FrecuenciaGuia ? String(f.FrecuenciaGuia) : etiqueta(f && f.Frecuencia);
  }

  // Si el rotulo de la guia no es el literal de la base, el tooltip lo dice.
  function notaFrecuencia(f) {
    if (!f || !f.FrecuenciaGuia || normal(f.FrecuenciaGuia) === normal(f.Frecuencia)) return null;
    return 'En la base: "' + etiqueta(f.Frecuencia) + '"';
  }

  /* Orden FIJO de las barras de Frecuencia: de lo mas recurrente a lo menos.
     Es solo presentacion: el API sigue mandando su orden (el de la guia) y
     no se toca. No depende de conteos ni del orden de llegada. */
  var ORDEN_FRECUENCIA = ['Siempre', 'Frecuente', 'Ocasional', 'Primera vez'];

  /* Filas de Frecuencia en ORDEN_FRECUENCIA. Un nivel que no llego (el SP
     no devuelve filas en cero) conserva su lugar con una fila hueco
     { sinDato: true } en vez de dejar que las demas se corran. Una fila que
     no cae en ningun nivel va al final, en el orden del API: no se pierde. */
  function ordenFrecuencia(filas) {
    var lista = filas || [];
    var usadas = [];
    var salida = ORDEN_FRECUENCIA.map(function (nivel) {
      for (var i = 0; i < lista.length; i++) {
        if (!usadas[i] && normal(etiquetaFrecuencia(lista[i])) === normal(nivel)) {
          usadas[i] = true;
          return lista[i];
        }
      }
      return { FrecuenciaGuia: nivel, CantidadTickets: 0, sinDato: true };
    });
    lista.forEach(function (f, i) { if (!usadas[i]) salida.push(f); });
    return salida;
  }

  /* Filas de la tabla de recurrentes por categoria, ya formateadas y en el
     orden del API (Posicion ASC). Categoria completa; tickets y % tal como
     los manda el SP. */
  function filasRecurrentes(filas) {
    return (filas || []).map(function (f) {
      return { categoria: etiqueta(f.Categoria), tickets: entero(f.CantidadTickets), pct: pct(f.PorcentajeRecurrentes) };
    });
  }

  /* ---- Descarga ("⬇ Descargar QARE") ----
     Columnas del libro: [llave que manda qare_exportar.ashx (el orden de
     QareExportar.Columnas), encabezado, ancho en caracteres]. La llave es
     el nombre de la columna en dbo.usp_CorreoQARE_Detalle (C1, Lider y
     QARe_VerificoClasificacion, en la TVF) y el encabezado es ese mismo
     nombre, salvo UsuarioConfirmo: es la bandera 0/1 que el SP calcula de
     QARe_VerificoClasificacion, NO de QARe_UsuarioConfirmo (otra pregunta),
     y el encabezado lo dice para que nadie las confunda. */
  var COLUMNAS_EXPORT = [
    // Ticket / contexto
    ['CodigoTicket', 'CodigoTicket', 15],
    ['FechaRegistro', 'FechaRegistro', 19],
    ['Tipo', 'Tipo', 14],
    ['TipoRelacion', 'TipoRelacion', 16],
    ['Estado', 'Estado', 16],
    ['Subestado', 'Subestado', 18],
    ['Prioridad', 'Prioridad', 12],
    ['Categoria', 'Categoria', 30],
    ['Grupo', 'Grupo', 24],
    ['C1', 'C1', 22],
    ['Lider', 'Lider', 22],
    ['Tecnico', 'Tecnico', 26],
    ['Cliente', 'Cliente', 24],
    ['Sucursal', 'Sucursal', 24],
    ['Tienda', 'Tienda', 24],
    ['Titulo', 'Titulo', 42],
    ['Descripcion', 'Descripcion', 60],
    ['SolucionUsuario', 'SolucionUsuario', 45],
    ['FechaEstimadaResolucion', 'FechaEstimadaResolucion', 19],
    ['FechaFirmaSolucion', 'FechaFirmaSolucion', 19],
    ['FechaUltimaModificacion', 'FechaUltimaModificacion', 19],
    ['FechaFirmaCierre', 'FechaFirmaCierre', 19],
    ['FirmaCierreRevocacion', 'FirmaCierreRevocacion', 24],
    ['FirmaSolucion', 'FirmaSolucion', 24],
    ['ResponsableUltimaModificacion', 'ResponsableUltimaModificacion', 26],
    ['NotificadoPor', 'NotificadoPor', 26],
    ['FechaEstimadaOlaUc', 'FechaEstimadaOlaUc', 19],
    ['IntentosSolucion', 'IntentosSolucion', 10],
    ['ReasignacionesGrupo', 'ReasignacionesGrupo', 10],
    ['Caducada', 'Caducada', 10],
    ['RegistradoPor', 'RegistradoPor', 26],
    // QA
    ['QA_MensajeError', 'QA_MensajeError', 40],
    ['QA_Frecuencia', 'QA_Frecuencia', 18],
    ['QA_Aplicacion', 'QA_Aplicacion', 24],
    ['QA_PasoAPaso', 'QA_PasoAPaso', 45],
    // QARE
    ['QARe_Causa', 'QARe_Causa', 40],
    ['QARe_UsuarioConfirmo', 'QARe_UsuarioConfirmo', 18],
    ['QARe_AplicaOtrosCasos', 'QARe_AplicaOtrosCasos', 18],
    ['QARe_GenerarArticulo', 'QARe_GenerarArticulo', 18],
    ['QARe_VerificoClasificacion', 'QARe_VerificoClasificacion', 18],
    ['QARe_Evidencia', 'QARe_Evidencia', 40],
    ['QARe_DescripcionSolucion', 'QARe_DescripcionSolucion', 45],
    ['QARe_TipoSolucion', 'QARe_TipoSolucion', 26],
    // Validacion / banderas 0/1 del SP (numero, tal cual)
    ['GrupoCorrecto', 'GrupoCorrecto', 24],
    ['Validacion', 'Validacion', 14],
    ['EsRecurrente', 'EsRecurrente', 12],
    ['UsuarioConfirmo', 'UsuarioConfirmo (VerificoClasificacion = Sí)', 22],
    ['EsCasoReutilizable', 'EsCasoReutilizable', 12],
    ['EsPotencialKB', 'EsPotencialKB', 12],
    ['EsInconsistenciaConfirmacionQA', 'EsInconsistenciaConfirmacionQA', 14],
    ['EsOportunidadKB', 'EsOportunidadKB', 12],
  ];

  /* Tope de Excel por celda: 32.767 caracteres; SheetJS se niega a escribir
     el libro si un solo valor lo pasa. Mismo recorte que LibroTickets de
     Experiencia: lo que no cabe termina con un aviso y no parte un par
     sustituto UTF-16. Solo afecta al libro, no a los datos. */
  var LIMITE_CELDA = 32767;
  function ajustarCelda(valor) {
    if (typeof valor !== 'string' || valor.length <= LIMITE_CELDA) return valor;
    var aviso = ' … [recortado: ' + valor.length + ' caracteres en origen]';
    var corte = LIMITE_CELDA - aviso.length;
    var c = valor.charCodeAt(corte - 1);
    if (c >= 0xD800 && c <= 0xDBFF) corte--;
    return valor.slice(0, corte) + aviso;
  }

  function listaFiltro(filtros, clave) {
    var v = ((filtros && filtros[clave]) || []).filter(function (x) { return x !== '' && x != null; });
    return v.length ? v.join(', ') : 'Todos';
  }

  // Cabecera del libro: el rango que confirmo el servidor y los filtros con
  // los que se pidio. `ahora` entra por parametro para que la prueba no
  // dependa del reloj.
  function metaExport(fi, ff, filtros, total, ahora) {
    return [
      ['Periodo (FechaFirmaSolucion)', fi + ' a ' + ff],
      ['Servicio / C1', listaFiltro(filtros, 'c1')],
      ['Grupos', listaFiltro(filtros, 'grupos')],
      ['Lideres', listaFiltro(filtros, 'lideres')],
      ['Total de tickets', NUM.format(total)],
      ['Exportado', ahora],
    ];
  }

  function nombreExport(fi, ff, filtros) {
    var filtrado = FILTROS_ORG.some(function (k) { return listaFiltro(filtros, k) !== 'Todos'; });
    return 'QARE_' + fi + '_a_' + ff + (filtrado ? '_filtrado' : '') + '.xlsx';
  }

  /* Tickets -> bytes del .xlsx. `XLSX` entra por parametro (no se toca
     window) para que la prueba le pase el mismo vendor. Lo que llega como
     texto va como texto -codigos y fechas no se reinterpretan como numero o
     fecha de Excel-; solo lo que el servidor manda como numero (banderas
     0/1, IntentosSolucion, ReasignacionesGrupo, Caducada) queda numero. */
  function libroExport(XLSX, tickets, meta) {
    var aoa = [['QARE — Tickets'], []];
    meta.forEach(function (m) { aoa.push([m[0], m[1]]); });
    aoa.push([]);
    var filaEncabezado = aoa.length;
    aoa.push(COLUMNAS_EXPORT.map(function (c) { return c[1]; }));
    tickets.forEach(function (t) {
      aoa.push(COLUMNAS_EXPORT.map(function (c) {
        var v = t[c[0]];
        if (typeof v === 'number') return v;
        return ajustarCelda(v === null || v === undefined ? '' : String(v));
      }));
    });
    var hoja = XLSX.utils.aoa_to_sheet(aoa);
    hoja['!cols'] = COLUMNAS_EXPORT.map(function (c) { return { wch: c[2] }; });
    hoja['!autofilter'] = { ref: XLSX.utils.encode_range({
      s: { r: filaEncabezado, c: 0 }, e: { r: aoa.length - 1, c: COLUMNAS_EXPORT.length - 1 } }) };
    var libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Tickets QARE');
    return XLSX.write(libro, { type: 'array', bookType: 'xlsx' });
  }

  var QareDatos = {
    numero: numero, entero: entero, pct: pct, etiqueta: etiqueta, normal: normal,
    claseValidacion: claseValidacion, matriz: matriz, partirEtiqueta: partirEtiqueta,
    rangoRapido: rangoRapido, diaMexico: diaMexico, pieKpi: pieKpi,
    etiquetaFrecuencia: etiquetaFrecuencia, notaFrecuencia: notaFrecuencia,
    ordenFrecuencia: ordenFrecuencia, ORDEN_FRECUENCIA: ORDEN_FRECUENCIA,
    consulta: consulta, FILTROS_ORG: FILTROS_ORG,
    filasRecurrentes: filasRecurrentes,
    COLUMNAS_EXPORT: COLUMNAS_EXPORT, LIMITE_CELDA: LIMITE_CELDA, ajustarCelda: ajustarCelda,
    metaExport: metaExport, nombreExport: nombreExport, libroExport: libroExport,
  };
  raiz.QareDatos = QareDatos;

  // ============================================================ 2. tablero
  if (typeof document === 'undefined') return;

  function ruta(handler) {
    var yo = document.currentScript && document.currentScript.src;
    try { return new URL('../handlers/' + handler, yo).href; }
    catch (e) { return 'handlers/' + handler; }
  }
  var API = ruta('qare.ashx');
  // Las listas de Servicio / Grupos / Lideres son las del Backlog: el diag
  // de la VM (sql/diag_qare_filtros_precheck.sql) confirmo que cubren a todos
  // los tickets de QARE.
  var API_CATALOGOS = ruta('backlog_catalogos.ashx');
  // Tickets del boton "⬇ Descargar QARE": mismos parametros que qare.ashx.
  var API_EXPORTAR = ruta('qare_exportar.ashx');
  /* SheetJS: el MISMO vendor que usa Experiencia, resuelto contra este
     script (embebido, el documento vive un nivel mas arriba). Como
     document.currentScript solo vale mientras el script se evalua, la ruta
     se fija aqui y no al pulsar. */
  var XLSX_URL = (function () {
    var yo = document.currentScript && document.currentScript.src;
    try { return new URL('../experiencia/vendor/xlsx.mini.min.js', yo).href; }
    catch (e) { return 'experiencia/vendor/xlsx.mini.min.js'; }
  })();

  var PREFIJO = 'qare-';
  function $(id) { return document.getElementById(PREFIJO + id); }
  function esc(v) { return Escape.html(v); }

  var DIAS_POR_OMISION = 15;
  var ALTO_FILA = 40;          // mismo alto por barra horizontal que qa.js

  /* Colores. Las barras de una sola serie van del azul de barra ordinaria
     compartido, Paleta.AZUL_SERIE (declarado en cada dataset). Los de
     la validacion son SEMANTICOS y son los mismos valores que ya usa la
     pestaña de QA para esos estados (qa/qa.js, COLOR_VALIDACION). */
  var COLOR_ESTADO = { ok: '#5aa726', mal: '#982a18', sin: '#b09512' };
  var COLOR_ACUMULADO = Paleta.PALETA_CATEGORICA[4];
  var TINTA = { eje: '#5e5e5f', etiqueta: '#393939', rejilla: '#eef1ea' };

  var graficas = {};
  var peticion = 0;

  // ---------------------------------------------------------- mensajes
  function mensaje(id, texto, esError) {
    var caja = $('msg-' + id);
    if (!caja) return;
    caja.hidden = !texto;
    caja.textContent = texto || '';
    caja.classList.toggle('qare-msg-error', !!esError);
  }

  function destruir(clave) {
    if (graficas[clave]) { graficas[clave].destroy(); graficas[clave] = null; }
  }

  /* Un bloque sin lista: null = fallo (el mensaje viene en errores), [] =
     sin datos. Devuelve true si ya se atendio y no hay nada que graficar. */
  function sinFilas(clave, filas, errores) {
    if (filas === null || filas === undefined) {
      destruir(clave);
      mensaje(clave, (errores && errores[claveApi(clave)]) || 'Sin datos: el bloque no llego.', true);
      return true;
    }
    if (!filas.length) {
      destruir(clave);
      mensaje(clave, 'Sin datos en el rango.');
      return true;
    }
    mensaje(clave, null);
    return false;
  }

  function claveApi(clave) {
    return { frecuencia: 'frecuencia', causa: 'causaRaiz', tipo: 'tipoSolucion' }[clave] || clave;
  }

  // -------------------------------------------------------------- KPIs
  /* Pregunta de cada KPI: la del formulario QA/QARE de la que sale y que
     respuestas cuenta. No se ve en la tarjeta: arriba solo va una franja
     fina "Pregunta" (un <button>) y el texto sale en un globo al pasar el
     mouse, al enfocarla con teclado o al tocarla. Solo texto fijo: no toca
     el dato. Por titulo del KPI: [pregunta, nota]. "Tickets evaluados" no
     sale de ninguna pregunta y va sin franja. */
  var KPI_CONTEXTO = {
    'Verificación de Tickets': ['QARE · ¿Verificaste la correcta clasificación del ticket?',      'Considera: Sí'],
    'Casos recurrentes':       ['QA · ¿Con qué frecuencia ocurre?',                               'Considera: Frecuente + Siempre'],
    'Casos reutilizables':     ['QARE · ¿Esta solución aplica para otros casos similares?',       'Considera: Sí'],
    'Potencial KB':            ['QARE · ¿Se debe generar o actualizar artículo de conocimiento?', 'Considera: Sí'],
  };

  function tarjeta(titulo, valor, pie) {
    var c = KPI_CONTEXTO[titulo];
    return '<div class="kpi' + (c ? ' qare-kpi-ctx' : '') + '">' +
      (c ? '<button type="button" class="qare-kpi-preg" data-titulo="' + esc(titulo) + '"' +
           ' aria-describedby="qare-kpi-globo" aria-expanded="false"' +
           ' aria-label="Pregunta de ' + esc(titulo) + ': ' + esc(c[0] + ' ' + c[1]) + '">Pregunta</button>' : '') +
      '<div class="lbl">' + esc(titulo) + '</div>' +
      '<div class="val">' + esc(valor) + '</div>' +
      '<div class="foot">' + esc(pie) + '</div></div>';
  }

  /* Globo de la pregunta. Es UNO solo, fuera de las tarjetas (#qare-kpi-globo
     en qare.html): .kpi recorta con overflow: hidden y se desplaza con
     transform al pasar el mouse, y cualquiera de los dos lo cortaria. Va con
     position: fixed bajo la franja, acotado al ancho de la ventana. */
  var franjaAbierta = null;

  function mostrarPregunta(franja) {
    var globo = $('kpi-globo');
    var c = KPI_CONTEXTO[franja.getAttribute('data-titulo')];
    if (!globo || !c) return;
    if (franjaAbierta && franjaAbierta !== franja) franjaAbierta.setAttribute('aria-expanded', 'false');
    franjaAbierta = franja;
    franja.setAttribute('aria-expanded', 'true');
    $('kpi-globo-preg').textContent = c[0];
    $('kpi-globo-nota').textContent = c[1];
    globo.hidden = false;
    var r = franja.getBoundingClientRect();
    var ancho = globo.offsetWidth, margen = 8;
    var izq = Math.min(Math.max(margen, r.left + r.width / 2 - ancho / 2),
      document.documentElement.clientWidth - ancho - margen);
    globo.style.left = Math.max(margen, izq) + 'px';
    globo.style.top = (r.bottom + 6) + 'px';
    globo.classList.add('visible');
  }

  function ocultarPregunta() {
    var globo = $('kpi-globo');
    if (franjaAbierta) franjaAbierta.setAttribute('aria-expanded', 'false');
    franjaAbierta = null;
    if (globo) { globo.classList.remove('visible'); globo.hidden = true; }
  }

  function conectarPreguntas() {
    var kpis = $('kpis');
    function franjaDe(e) { return e.target.closest && e.target.closest('.qare-kpi-preg'); }
    // Mouse: entrar muestra, salir oculta. El toque no dispara esto (ver click).
    kpis.addEventListener('pointerover', function (e) {
      var f = franjaDe(e);
      if (f && e.pointerType === 'mouse') mostrarPregunta(f);
    });
    kpis.addEventListener('pointerout', function (e) {
      var f = franjaDe(e);
      if (f && e.pointerType === 'mouse' && !f.contains(e.relatedTarget)) ocultarPregunta();
    });
    // Toque (y Enter/Espacio): alterna. Un toque fuera lo cierra.
    kpis.addEventListener('click', function (e) {
      var f = franjaDe(e);
      if (!f) return;
      e.stopPropagation();
      // Con mouse el globo ya salio al entrar: el clic no lo cierra.
      if (franjaAbierta === f && e.pointerType !== 'mouse') ocultarPregunta();
      else mostrarPregunta(f);
    });
    // Teclado: al llegar con Tab. Solo :focus-visible, porque un toque
    // tambien enfoca el boton y abriria el globo antes de que el click lo alterne.
    kpis.addEventListener('focusin', function (e) {
      var f = franjaDe(e);
      if (f && f.matches(':focus-visible')) mostrarPregunta(f);
    });
    kpis.addEventListener('focusout', function (e) { if (franjaDe(e)) ocultarPregunta(); });
    document.addEventListener('click', function (e) {
      if (franjaAbierta && !franjaAbierta.contains(e.target)) ocultarPregunta();
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') ocultarPregunta(); });
    // Fijo en pantalla: al desplazar o cambiar el ancho quedaria despegado.
    window.addEventListener('scroll', ocultarPregunta, true);
    window.addEventListener('resize', ocultarPregunta);
  }

  // [titulo, porcentaje, numerador, denominador] con los nombres del SP.
  var KPIS = [
    ['Tickets evaluados',    'TotalTicketsPeriodo',          null,                 null],
    ['Verificación de Tickets', 'PorcentajeConfirmacion',       'TicketsConfirmados', 'TicketsConRespuestaConfirmacion'],
    ['Casos recurrentes',    'PorcentajeRecurrencia',        'TicketsRecurrentes', 'TicketsConFrecuencia'],
    ['Casos reutilizables',  'PorcentajeCasosReutilizables', 'CasosReutilizables', 'TicketsConRespuestaReutilizacion'],
    ['Potencial KB',         'PorcentajePotencialKB',        'CasosPotencialKB',   'TicketsConRespuestaKB'],
  ];

  // Tarjeta 1: el total. Tarjetas 2-5: porcentaje grande y "X de Y" abajo.
  function pintarKpis(k, relleno) {
    ocultarPregunta();
    $('kpis').innerHTML = KPIS.map(function (d, i) {
      if (!k) return tarjeta(d[0], relleno, i === 0 ? 'Total del periodo' : '');
      if (i === 0) return tarjeta(d[0], entero(k[d[1]]), 'Total del periodo');
      return tarjeta(d[0], pct(k[d[1]]), pieKpi(k[d[2]], k[d[3]]));
    }).join('');
  }

  // ---------------------------------------------------------- graficas
  function ejes(horizontal, extraX, extraY) {
    var valor = { beginAtZero: true, ticks: { precision: 0, color: TINTA.eje }, grid: { color: TINTA.rejilla } };
    var categoria = { ticks: { color: TINTA.etiqueta, autoSkip: false }, grid: { display: false } };
    return horizontal
      ? { x: Object.assign(valor, extraX || {}), y: Object.assign(categoria, extraY || {}) }
      : { x: Object.assign(categoria, extraX || {}), y: Object.assign(valor, extraY || {}) };
  }

  function barras(clave, canvas, etiquetas, datos, horizontal, tooltip) {
    destruir(clave);
    graficas[clave] = new DashboardBarChart({
      canvas: $(canvas),
      etiquetas: etiquetas,
      datos: datos,
      // Explicito: sin ningun color declarado, el plugin Colors de Chart.js 4
      // repinta la serie con su propio azul translucido y pisa el default.
      dataset: { backgroundColor: Paleta.AZUL_SERIE },
      formato: function (v) { return NUM.format(v); },
      opciones: {
        indexAxis: horizontal ? 'y' : 'x',
        maintainAspectRatio: false,
        layout: { padding: horizontal ? { right: 26 } : { top: 18 } },
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: tooltip } } },
        scales: ejes(horizontal),
      },
    }).render();
  }

  // Seccion 2: columnas en el orden fijo de ORDEN_FRECUENCIA (ordenFrecuencia).
  function pintarFrecuencia(filas, errores) {
    $('hint-frecuencia').textContent = '';
    if (sinFilas('frecuencia', filas, errores)) return;
    filas = ordenFrecuencia(filas);
    barras('frecuencia', 'chart-frecuencia',
      filas.map(etiquetaFrecuencia),
      filas.map(function (f) { return numero(f.CantidadTickets); }),
      false,
      function (item) {
        var f = filas[item.dataIndex];
        if (f.sinDato) return 'Sin tickets en el rango';
        var linea = entero(f.CantidadTickets) + ' tickets · ' + pct(f.Porcentaje);
        var nota = notaFrecuencia(f);
        return nota ? [linea, nota] : linea;
      });
  }

  /* Seccion 3: Pareto. Barras = CantidadTickets (eje izquierdo), linea =
     PorcentajeAcumulado (eje derecho, 0-100 %), y la referencia del 80 %
     como una linea punteada sobre ese mismo eje. El orden es Posicion ASC,
     que es el del calculo del acumulado. */
  /* La cifra del acumulado encima de cada punto de la linea: en un Pareto
     lo que se busca es "donde cruza el 80 %", y sin la cifra habia que ir
     punto por punto con el mouse. Tinta de texto, no el color de la serie. */
  var CIFRAS_ACUMULADO = {
    id: 'qareCifrasAcumulado',
    afterDatasetsDraw: function (chart) {
      var meta = chart.getDatasetMeta(1);
      if (!meta || meta.hidden) return;
      var datos = chart.data.datasets[1].data;
      var ctx = chart.ctx;
      ctx.save();
      ctx.font = Barras.fuente(11);
      ctx.fillStyle = TINTA.etiqueta;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      meta.data.forEach(function (punto, i) {
        if (datos[i] === null || datos[i] === undefined) return;
        ctx.fillText(NUM1.format(datos[i]) + ' %', punto.x, punto.y - 8);
      });
      ctx.restore();
    },
  };

  function pintarCausa(filas, errores) {
    $('hint-causa').textContent = 'Pareto · referencia 80 %';
    if (sinFilas('causa', filas, errores)) return;
    destruir('causa');
    var etiquetas = filas.map(function (f) { return etiqueta(f.CausaRaiz); });
    $('hint-causa').textContent = filas.length + ' causas · Pareto · referencia 80 %';
    graficas.causa = new DashboardBarChart({
      canvas: $('chart-causa'),
      // El nombre completo, partido en lineas cortas: sin recorte ni giro.
      etiquetas: etiquetas.map(function (t) { return partirEtiqueta(t, 14); }),
      formato: function (v) { return NUM.format(v); },
      // A todo el ancho, la barra del default (44px) se veia delgada.
      barra: { maxBarThickness: 64 },
      datasets: [
        { type: 'bar', label: 'Tickets', yAxisID: 'y', order: 3, backgroundColor: Paleta.AZUL_SERIE,
          data: filas.map(function (f) { return numero(f.CantidadTickets); }) },
        { type: 'line', label: '% acumulado', yAxisID: 'y2', order: 1,
          data: filas.map(function (f) { return numero(f.PorcentajeAcumulado); }),
          borderColor: COLOR_ACUMULADO, backgroundColor: COLOR_ACUMULADO,
          borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0 },
        { type: 'line', label: 'Referencia 80 %', yAxisID: 'y2', order: 2,
          data: etiquetas.map(function () { return 80; }),
          borderColor: Paleta.NEUTRO, borderWidth: 1.5, borderDash: [6, 4],
          pointRadius: 0, pointHoverRadius: 0, fill: false },
      ],
      plugins: [CIFRAS_ACUMULADO],
      opciones: {
        maintainAspectRatio: false,
        layout: { padding: { top: 26, right: 8, left: 8 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: true, position: 'bottom', labels: { boxWidth: 12, color: TINTA.etiqueta, font: { size: 12 } } },
          tooltip: {
            filter: function (item) { return item.datasetIndex !== 2; },
            callbacks: {
              title: function (items) { return items.length ? etiquetas[items[0].dataIndex] : ''; },
              label: function (item) {
                var f = filas[item.dataIndex];
                return item.datasetIndex === 0
                  ? entero(f.CantidadTickets) + ' tickets · ' + pct(f.Porcentaje)
                  : 'Acumulado: ' + pct(f.PorcentajeAcumulado);
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: TINTA.etiqueta, autoSkip: false, maxRotation: 0, font: { size: 11.5 } },
               grid: { display: false } },
          y: { beginAtZero: true, grace: '8%', ticks: { precision: 0, color: TINTA.eje, font: { size: 12 } },
               grid: { color: TINTA.rejilla },
               title: { display: true, text: 'Tickets', color: TINTA.eje, font: { size: 12 } } },
          y2: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false },
                ticks: { color: TINTA.eje, stepSize: 20, font: { size: 12 }, callback: function (v) { return v + ' %'; } },
                title: { display: true, text: '% acumulado', color: TINTA.eje, font: { size: 12 } } },
        },
      },
    }).render();
  }

  function altoFilas(n, minimo) { return Math.max(minimo, n * ALTO_FILA + 48) + 'px'; }

  /* Seccion 4: tabla completa en orden de Posicion (el que manda el API).
     Categoria entera, sin recortar; el % es PorcentajeRecurrentes, la parte
     de los tickets recurrentes del periodo, tal cual lo da el SP. */
  function pintarRecurrentes(filas, errores) {
    var cont = $('tabla-recurrentes');
    var hint = $('hint-recurrentes');
    hint.textContent = '';
    if (filas === null || filas === undefined) {
      cont.innerHTML = '<div class="vacio qare-vacio-error">' +
        esc((errores && errores.recurrentesCategoria) || 'Sin datos: el bloque no llego.') + '</div>';
      return;
    }
    if (!filas.length) { cont.innerHTML = '<div class="vacio">Sin datos en el rango.</div>'; return; }

    var total = numero(filas[0].TotalTicketsRecurrentes);
    hint.textContent = filas.length + ' categorias' +
      (total === null ? '' : ' · % sobre ' + NUM.format(total) + ' tickets recurrentes');
    cont.innerHTML = '<table class="qare-tabla-rec"><thead><tr>' +
      '<th scope="col">Categoria</th><th scope="col" class="num">Tickets</th><th scope="col" class="num">%</th>' +
      '</tr></thead><tbody>' +
      filasRecurrentes(filas).map(function (r) {
        return '<tr><td class="txt">' + esc(r.categoria) + '</td><td class="num">' + esc(r.tickets) +
          '</td><td class="num">' + esc(r.pct) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // Seccion 6: todas las filas, por Posicion.
  function pintarTipo(filas, errores) {
    $('hint-tipo').textContent = '';
    if (sinFilas('tipo', filas, errores)) {
      $('lienzo-tipo').style.height = '';
      return;
    }
    $('lienzo-tipo').style.height = altoFilas(filas.length, 260);
    barras('tipo', 'chart-tipo',
      filas.map(function (f) { return partirEtiqueta(etiqueta(f.TipoSolucion), 34); }),
      filas.map(function (f) { return numero(f.CantidadTickets); }),
      true,
      function (item) {
        var f = filas[item.dataIndex];
        return entero(f.CantidadTickets) + ' tickets · ' + pct(f.Porcentaje);
      });
  }

  // -------------------------------------------------------------- matriz
  function mezclaConBlanco(hex, a) {
    var c = hex.replace('#', '');
    var canal = function (i) {
      var v = parseInt(c.slice(i, i + 2), 16);
      return Math.round(v * a + 255 * (1 - a)).toString(16).padStart(2, '0');
    };
    return '#' + canal(0) + canal(2) + canal(4);
  }

  /* Seccion 5. Filas = ConfirmacionUsuario, columnas = ValidacionQA, valor =
     CantidadTickets y el % del total en el title. El color es el del estado
     de la COLUMNA, mas intenso cuanto mas tickets tiene la celda; el nombre
     del estado va siempre en el encabezado, asi que el color nunca es la
     unica pista. */
  function pintarMatriz(filas, error) {
    var cont = $('matriz');
    if (filas === null || filas === undefined) {
      cont.innerHTML = '<div class="vacio qare-vacio-error">' +
        esc(error || 'Sin datos: el bloque no llego.') + '</div>';
      return;
    }
    if (!filas.length) { cont.innerHTML = '<div class="vacio">Sin datos en el rango.</div>'; return; }

    var m = matriz(filas);
    var html = '<table class="qare-matriz"><thead><tr>' +
      '<th scope="col">Confirmacion usuario \\ Validacion QA</th>' +
      m.columnas.map(function (c) {
        var k = claseValidacion(c);
        return '<th scope="col" class="num">' + (k ? '<i class="qare-' + k + '"></i>' : '') + esc(c) + '</th>';
      }).join('') + '</tr></thead><tbody>';

    m.filas.forEach(function (r) {
      html += '<tr><th scope="row">' + esc(r) + '</th>';
      m.columnas.forEach(function (c) {
        var celda = m.celdas[r][c];
        if (!celda || celda.cantidad === null) {
          html += '<td class="num qare-celda-vacia" title="' + esc(r + ' · ' + c + ': sin tickets') + '">—</td>';
          return;
        }
        var k = claseValidacion(c);
        var base = k ? COLOR_ESTADO[k] : Paleta.NEUTRO;
        var fondo = mezclaConBlanco(base, 0.12 + 0.58 * (m.max ? celda.cantidad / m.max : 0));
        html += '<td class="num" style="background:' + fondo + ';color:' + Barras.tintaSobre(fondo) + '"' +
          ' title="' + esc(r + ' · ' + c + ': ' + entero(celda.cantidad) + ' tickets (' +
          pct(celda.pct) + ' del total)') + '">' + entero(celda.cantidad) + '</td>';
      });
      html += '</tr>';
    });
    cont.innerHTML = html + '</tbody></table>';
  }

  // ------------------------------------------------------------ peticion
  // `api` por omision es qare.ashx; la descarga pasa qare_exportar.ashx.
  function pedir(qs, api) {
    api = api || API;
    return fetch(api + '?' + qs, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (resp) {
        return resp.text().then(function (texto) {
          var datos = null;
          try { datos = texto ? JSON.parse(texto) : null; } catch (e) { datos = null; }
          if (!resp.ok) {
            // El handler responde {error, tipo}; si llega otra cosa (una
            // pagina de IIS), un texto generico con el codigo.
            throw new Error(datos && typeof datos.error === 'string'
              ? datos.error : 'El servidor respondio con el codigo ' + resp.status + '.');
          }
          if (!datos) throw new Error('La respuesta del servidor llego vacia o con un formato no valido.');
          return datos;
        });
      }, function () {
        throw new Error('No se pudo contactar a ' + api.split('/').pop() +
          '. Revisa que el sitio este publicado y en ejecucion.');
      });
  }

  function enEspera() {
    pintarKpis(null, '—');
    ['frecuencia', 'causa', 'tipo'].forEach(function (k) { mensaje(k, 'Calculando…'); });
    $('matriz').innerHTML = '<div class="vacio">Calculando…</div>';
    $('tabla-recurrentes').innerHTML = '<div class="vacio">Calculando…</div>';
    DatosInfo.mensaje($('estado'), 'Cargando…');
  }

  function fallo(err) {
    pintarKpis(null, 'n/d');
    ['frecuencia', 'causa', 'tipo'].forEach(function (k) {
      destruir(k);
      mensaje(k, 'Error al cargar datos.', true);
    });
    $('matriz').innerHTML = '<div class="vacio qare-vacio-error">Error al cargar datos.</div>';
    $('tabla-recurrentes').innerHTML = '<div class="vacio qare-vacio-error">Error al cargar datos.</div>';
    DatosInfo.mensaje($('estado'), 'Error al cargar datos: ' + err.message, err.message);
    $('error-msg').textContent = err.message;
    $('error').hidden = false;
    console.error('[QARE]', err);
  }

  function pintar(d) {
    var errores = d.errores || {};
    pintarKpis(d.kpis || null, errores.kpis ? 'n/d' : '—');
    pintarFrecuencia(d.frecuencia, errores);
    pintarCausa(d.causaRaiz, errores);
    pintarRecurrentes(d.recurrentesCategoria, errores);
    pintarTipo(d.tipoSolucion, errores);
    pintarMatriz(d.confirmacionVsQa, errores.confirmacionVsQa);

    var fallidos = Object.keys(errores);
    // Pastilla de la cabecera: "Última actualización" y "Periodo" de
    // d.dataInfo. Si fallo algun dataset se agrega el aviso.
    DatosInfo.pintar($('estado'), d.dataInfo, fallidos.length ? {
      sufijo: ' · ⚠ sin datos de: ' + fallidos.join(', '),
      titulo: fallidos.map(function (k) { return k + ': ' + errores[k]; }).join('\n'),
    } : undefined);
    fallidos.forEach(function (k) { console.error('[QARE ' + k + ']', errores[k]); });

    var avisos = (d.avisos || []).concat(errores.kpis ? ['KPIs: ' + errores.kpis] : []);
    $('avisos').hidden = !avisos.length;
    $('avisos').innerHTML = avisos.map(function (a) { return '<div>' + esc(a) + '</div>'; }).join('');
  }

  function cargar() {
    var fi = $('f-inicio').value, ff = $('f-fin').value;
    $('error').hidden = true;

    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      fallo(new Error('Esta pagina necesita el servidor: abrela desde el sitio publicado en IIS ' +
        'o desde la pestaña QARE del tablero.'));
      return;
    }
    if (!fi || !ff || fi > ff) {
      fallo(new Error('Rango de fechas invalido: la fecha inicio debe ser anterior o igual a la fecha fin.'));
      return;
    }

    var token = ++peticion;
    enEspera();
    pedir(consulta(fi, ff, filtrosElegidos()))
      .then(function (d) { if (token === peticion) pintar(d); })
      .catch(function (err) { if (token === peticion) fallo(err); });
  }

  // ------------------------------------------------------------ descarga
  /* SheetJS se trae la primera vez que se pulsa el boton, no al cargar la
     pestaña (son ~250 KB que casi ninguna visita usa). Si Experiencia ya lo
     cargo, se reusa. */
  var xlsxCargando = null;
  function cargarXLSX() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    if (!xlsxCargando) {
      xlsxCargando = new Promise(function (listo, fallo) {
        var s = document.createElement('script');
        s.src = XLSX_URL;
        s.onload = function () { listo(window.XLSX); };
        s.onerror = function () { xlsxCargando = null; fallo(new Error('no se pudo cargar ' + s.src)); };
        document.head.appendChild(s);
      });
    }
    return xlsxCargando;
  }

  function bajar(bytes, nombre) {
    var url = URL.createObjectURL(new Blob([bytes],
      { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    var a = document.createElement('a');
    a.href = url; a.download = nombre;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  /* Como "Descargar Tickets" de Experiencia: el boton solo se ve con algun
     filtro de Servicio / Grupo / Lider puesto. Se revisa en cada `change` de
     los tres selects (Limpiar tambien los dispara). */
  function hayFiltroOrg() {
    return FILTROS_ORG.some(function (clave) { return seleccionados(SELECT_FILTRO[clave]).length > 0; });
  }
  function actualizarDescarga() {
    $('btn-descargar').style.display = hayFiltroOrg() ? '' : 'none';
  }

  /* Los tickets del rango y los filtros que se estan viendo: la MISMA
     consulta() que pide el tablero, a qare_exportar.ashx: el detalle de
     dbo.usp_CorreoQARE_Detalle, filtrado por la misma fuente que los seis SP. */
  var descargando = false;
  function descargar() {
    if (descargando) return;
    var fi = $('f-inicio').value, ff = $('f-fin').value;
    if (!fi || !ff || fi > ff) {
      alert('Rango de fechas invalido: la fecha inicio debe ser anterior o igual a la fecha fin.');
      return;
    }
    var filtros = filtrosElegidos();
    var btn = $('btn-descargar'), rotulo = btn.textContent;
    descargando = true;
    btn.disabled = true;
    btn.textContent = 'Preparando…';
    pedir(consulta(fi, ff, filtros), API_EXPORTAR)
      .then(function (d) {
        var tickets = d.tickets || [];
        if (!tickets.length) { alert('No hay tickets QARE para el rango y los filtros actuales.'); return; }
        return cargarXLSX().then(function (XLSX) {
          var meta = metaExport(d.fechaInicio, d.fechaFin, filtros, tickets.length,
            new Date().toLocaleString('es-MX'));
          bajar(libroExport(XLSX, tickets, meta), nombreExport(d.fechaInicio, d.fechaFin, filtros));
        });
      })
      .catch(function (err) {
        console.error('[QARE descarga]', err);
        alert('No se pudo descargar QARE: ' + err.message);
      })
      .then(function () {
        descargando = false;
        btn.disabled = false;
        btn.textContent = rotulo;
      });
  }

  // ----------------------------------------------- filtros organizacionales
  var SELECT_FILTRO = { c1: 'f-c1', grupos: 'f-grupos', lideres: 'f-lideres' };

  function seleccionados(id) {
    return Array.prototype.map.call($(id).selectedOptions, function (o) { return o.value; });
  }

  function filtrosElegidos() {
    var f = {};
    FILTROS_ORG.forEach(function (clave) { f[clave] = seleccionados(SELECT_FILTRO[clave]); });
    return f;
  }

  /* Las listas, una vez al arrancar y sin frenar la primera carga de datos:
     si fallan, QARE sigue funcionando sin filtros y el error va a la consola. */
  function cargarCatalogos() {
    return fetch(API_CATALOGOS, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (resp) {
        if (!resp.ok) throw new Error('backlog_catalogos.ashx respondio ' + resp.status + '.');
        return resp.json();
      })
      .then(function (c) {
        Catalogos.llenar($('f-c1'), (c && c.c1) || []);
        Catalogos.llenar($('f-grupos'), (c && c.grupos) || []);
        Catalogos.llenar($('f-lideres'), (c && c.lideres) || []);
      })
      .catch(function (err) { console.error('[QARE catalogos]', err); });
  }

  /* Mismo auto-aplicado que el Backlog: los cambios seguidos de los
     multiselect se juntan en una sola peticion. */
  var ESPERA_AUTO = 250;
  var cargaProgramada = null;
  function programarCarga() {
    clearTimeout(cargaProgramada);
    cargaProgramada = setTimeout(function () { cargaProgramada = null; cargar(); }, ESPERA_AUTO);
  }

  // "Limpiar" quita solo los tres filtros organizacionales; las fechas no.
  // El `change` repinta el desplegable y programa la recarga.
  function limpiarFiltros() {
    FILTROS_ORG.forEach(function (clave) {
      var sel = $(SELECT_FILTRO[clave]);
      Array.prototype.forEach.call(sel.options, function (o) { o.selected = false; });
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
  }

  function marcarRapido(dias) {
    document.querySelectorAll('#qare-filtros [data-dias]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.dias) === dias));
    });
  }

  function ponerRango(dias) {
    var r = rangoRapido(dias, Date.now());
    $('f-inicio').value = r.inicio;
    $('f-fin').value = r.fin;
    marcarRapido(dias);
  }

  function conectar() {
    document.querySelectorAll('#qare-filtros [data-dias]').forEach(function (b) {
      b.addEventListener('click', function () { ponerRango(Number(b.dataset.dias)); cargar(); });
    });
    ['f-inicio', 'f-fin'].forEach(function (id) {
      $(id).addEventListener('change', function () { marcarRapido(null); cargar(); });
    });
    $('reintentar').addEventListener('click', cargar);
    FILTROS_ORG.forEach(function (clave) {
      $(SELECT_FILTRO[clave]).addEventListener('change', programarCarga);
      $(SELECT_FILTRO[clave]).addEventListener('change', actualizarDescarga);
    });
    $('btn-limpiar').addEventListener('click', limpiarFiltros);
    $('btn-descargar').addEventListener('click', descargar);
    conectarPreguntas();
    $('dicc-boton').addEventListener('click', function () {
      plegarDiccionario(this.getAttribute('aria-expanded') !== 'true');
    });
  }

  /* Diccionario: nace plegado (el marcado ya trae aria-expanded="false") y
     el estado vive solo en el DOM, como la tabla de SLA por lider y grupo.
     El CSS lee aria-expanded para abrir el cuerpo; recargar datos no lo toca. */
  function plegarDiccionario(abrir) {
    var boton = $('dicc-boton');
    boton.setAttribute('aria-expanded', String(abrir));
    boton.setAttribute('aria-label', (abrir ? 'Ocultar' : 'Mostrar') + ' diccionario de preguntas QARE');
  }

  var arrancado = false;
  function arrancar() {
    if (arrancado || !$('kpis')) return;
    arrancado = true;
    Barras.aplicarDefaults();
    ponerRango(DIAS_POR_OMISION);
    /* La capa visual de los multiselect. Como en backlog.js: embebido, el
       Desplegable.montar(document) de dashboard.js ya corrio antes de que
       existiera este marcado, asi que se monta aqui sobre la raiz del modulo.
       montar() es idempotente. */
    if (window.Desplegable) Desplegable.montar(document.getElementById('tab-qare') || document);
    conectar();
    cargarCatalogos();
    cargar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  /* Lo unico que el modulo publica hacia fuera, para TableroQare
     (dashboard.js): al volver a la pestaña se remiden las graficas, que
     midieron cero mientras su contenedor estuvo oculto. */
  raiz.TableroQareModulo = {
    redimensionar: function () {
      Object.keys(graficas).forEach(function (k) { if (graficas[k]) graficas[k].resize(); });
    },
    recargar: cargar,
  };
})(window);
