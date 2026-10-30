/* =========================================================================
   qa/qa.js

   Tablero de QA. Un solo archivo para los dos sitios donde vive el modulo: la
   pagina suelta qa/qa.html y la pestaña "QA" de dashboard.html, que monta ese
   mismo marcado e inyecta este mismo script (ver TableroQa en dashboard.js).
   No hay una segunda copia de esta logica en el tablero.

   Tablero de QA. Toda la informacion viene de qa.ashx, que la consulta en
   vivo a SQL Server. El navegador nunca habla con la base: no conoce el
   servidor, ni el usuario, ni la cadena de conexion (viven en Web.config,
   del lado del servidor).

   Ventana de datos: los ultimos 15 dias, la misma de usp_CorreoQA_Kpis, para
   que el tablero y el correo diario de QA cuadren.

   Peticiones:
     - carga inicial : qa.ashx?action=summary            (~10 KB)
                       KPIs, grupos, tecnicos y recategorizacion. Solo mira
                       los tickets incorrectos del rango, que son una fraccion
                       del total: por eso es la peticion rapida.
     - completo      : qa.ashx?action=qare               (en segundo plano,
                       en cuanto el resumen esta pintado)
                       Distribucion por estado. Recorre TODOS los tickets del
                       rango, asi que tarda; por eso no bloquea la carga y su
                       panel se rellena al llegar. La respuesta trae ademas los
                       contadores QA/QARE y el top de categorias, que hoy no se
                       pintan: el bloque que los mostraba en crudo se retiro de
                       la interfaz a la espera de una visualizacion mejor. El
                       endpoint y sus datos siguen intactos.
     - detalle       : qa.ashx?action=detail&...         (solo al pedirlo)
     - catalogos     : nunca desde aqui

   Nada de esto se pide al cargar dashboard.html: el modulo entero -marcado,
   hoja y script- se trae la primera vez que se abre la pestaña, y es entonces
   cuando sale la primera peticion.

   Regla de datos: lo que el API no trae, no se calcula aqui.

   Filtros (los de QARE): Fecha inicio / Fecha fin, Rango rapido 15 / 30
   dias, Servicio / C1, Grupos y Lideres, con las mismas listas
   (backlog_catalogos.ashx), el mismo multiselect y el mismo auto-aplicado.
   El rango por omision es el de siempre: los 15 dias que terminan AYER
   (QaParams.Rango), no hoy como en QARE, porque los KPIs "ayer" y "semana
   anterior" se cuentan desde el fin del rango. "Limpiar" quita solo los tres
   filtros organizacionales; las fechas se quedan. Se aplican a KPIs,
   distribucion por estado, recategorizacion y detalle (qa.ashx los resuelve
   en el servidor, ver App_Code/QaFiltroOrg.cs).

   Las dos graficas de Top 10 NO siguen a los filtros: salen siempre de la
   carga por omision (ventana de 15 dias, sin filtros) y nada de lo que se
   pida despues las repinta (ver pintarBase). Cuando la vista es la de por
   omision, esa misma peticion alimenta la pagina y las graficas: no se pide
   dos veces.

   "⬇ Descargar QA", como "⬇ Descargar QARE": solo sale con algun filtro de
   Servicio / Grupo / Lider puesto, pide a qa.ashx?action=detail&pageSize=0
   los tickets del rango y esos filtros (todos los estados de validacion) y
   arma el .xlsx aqui con el mismo SheetJS y el mismo formato.

   Dos partes, como qare.js:
     1. QaDatos: funciones PURAS (sin DOM), publicadas en window.QaDatos
        para tools/tests/QaFiltrosVistaSmoke.js.
     2. El tablero. Solo corre si hay documento.
   ========================================================================= */

(function (raiz) {
  'use strict';

  // ================================================================ 1. puro

  /* "Hoy" en Mexico con el MISMO reloj que el servidor: UTC menos 6 horas
     fijas (DashboardDataInfo.HoyEnPresentacion), igual que qare.js. */
  var MS_DIA = 864e5;
  var DESFASE_MEXICO = 6 * 36e5;
  function diaMexico(ms) { return Math.floor((ms - DESFASE_MEXICO) / MS_DIA); }
  function isoDia(n) { return new Date(n * MS_DIA).toISOString().slice(0, 10); }

  var DIAS_POR_OMISION = 15;

  /* Los `dias` dias que terminan AYER, incluido: la ventana de QaParams.Rango
     (@FechaFin = hoy-1, @FechaInicio = @FechaFin-14 para 15 dias). */
  function rangoRapido(dias, ahoraMs) {
    var fin = diaMexico(ahoraMs) - 1;
    return { inicio: isoDia(fin - (dias - 1)), fin: isoDia(fin) };
  }

  var FILTROS_ORG = ['c1', 'grupos', 'lideres'];

  function valoresFiltro(filtros, clave) {
    return ((filtros && filtros[clave]) || []).filter(function (v) { return v !== '' && v != null; });
  }

  function hayFiltroOrg(filtros) {
    return FILTROS_ORG.some(function (k) { return valoresFiltro(filtros, k).length > 0; });
  }

  // La vista por omision: el rango de siempre y ningun filtro.
  function esPorOmision(vista, defecto) {
    return !!vista && !!defecto && !hayFiltroOrg(vista.filtros) &&
      vista.inicio === defecto.inicio && vista.fin === defecto.fin;
  }

  /* Parametros de qa.ashx para una vista. La de por omision va SIN nada,
     exactamente la peticion de siempre (el servidor pone el rango); las
     demas llevan el rango y los filtros no vacios, como listas separadas por
     comas igual que consulta() de qare.js. */
  function parametrosVista(vista, defecto) {
    if (esPorOmision(vista, defecto)) return {};
    var p = { fecha_inicio: vista.inicio, fecha_fin: vista.fin };
    FILTROS_ORG.forEach(function (k) {
      var v = valoresFiltro(vista.filtros, k);
      if (v.length) p[k] = v.join(',');
    });
    return p;
  }

  /* ---- Descarga ("⬇ Descargar QA") ----
     Columnas del libro: [llave de la fila de qa.ashx, encabezado, ancho]. Las
     llaves son las columnas de dbo.usp_CorreoQA_Detalle -los encabezados del
     TICKETS QA - <fecha>.xlsx del correo-, en su orden, con C1 y Lider
     (QaFiltroOrg, las dos por las que se filtra) junto a Grupo, como en el
     libro de QARE. El encabezado es la misma llave: no se renombra nada. */
  var COLUMNAS_EXPORT = [
    ['Fecha de registro', 19], ['Fecha estimada resolución', 19], ['Código', 15],
    ['Grupo', 24], ['C1', 22], ['Lider', 22],
    ['Técnico de 2ª línea', 26], ['Estado', 16], ['Subestado', 18], ['Prioridad', 12],
    ['Título', 42], ['Descripción', 60], ['Cliente', 24], ['Sucursal', 24], ['Categoría', 30],
    ['Solución para el usuario', 45], ['Fecha firma solución', 19], ['Fecha última modificación', 19],
    ['Fecha firma cierre', 19], ['Firma cierre / revocación solución', 24], ['Firma solución', 24],
    ['Responsable última modificación', 26], ['Notificado por', 26], ['Tipo', 14],
    ['Fecha estimada OLA / UC', 19], ['Tiempo de resolución', 14],
    ['Tiempo atención (horas / minutos)', 14], ['Tiempo 1ª respuesta (horas / minutos)', 14],
    ['Intentos de solución', 10], ['Tiempo 1ª respuesta', 14], ['Tiempo de atención', 14],
    ['Reasignaciones grupo', 10], ['Caducada', 10], ['Registrado por', 26], ['Tipo relación', 16],
    ['QA - ¿Aparece algún mensaje de error o describe tu necesidad?', 40],
    ['QA - ¿Con qué frecuencia ocurre?', 18],
    ['QA - ¿En qué aplicación estabas cuando sucedió el incidente?', 24],
    ['QA - Describe paso a paso qué hiciste antes del error o detalla la petición requerida', 45],
    ['QARe - ¿Cuál fue la causa del incidente/petición?', 40],
    ['QARe - ¿El usuario confirmó la solución?', 18],
    ['QARe - ¿Esta solución aplica para otros casos similares?', 18],
    ['QARe - ¿Se debe generar o actualizar artículo de conocimiento?', 18],
    ['QARE - ¿Verificaste la correcta clasificación del ticket?', 18],
    ['QARe - Adjunta evidencia de la solución (logs, capturas, validación)', 40],
    ['QARe - Describe la solución aplicada (pasos claros y replicables)', 45],
    ['QARe - Tipo de solución aplicada', 26],
    ['Grupo Correcto', 24], ['Validacion', 14], ['Tienda', 24],
  ].map(function (c) { return [c[0], c[0], c[1]]; });

  // Columnas de parrafo: con ajuste de texto, como LARGAS_EXPORT de QARE.
  var LARGAS_EXPORT = ['Título', 'Descripción', 'Solución para el usuario',
    'QA - ¿Aparece algún mensaje de error o describe tu necesidad?',
    'QA - Describe paso a paso qué hiciste antes del error o detalla la petición requerida',
    'QARe - ¿Cuál fue la causa del incidente/petición?',
    'QARe - Adjunta evidencia de la solución (logs, capturas, validación)',
    'QARe - Describe la solución aplicada (pasos claros y replicables)'];

  // Tope de Excel por celda, con el mismo recorte que QARE y Experiencia.
  var LIMITE_CELDA = 32767;
  function ajustarCelda(valor) {
    if (typeof valor !== 'string' || valor.length <= LIMITE_CELDA) return valor;
    var aviso = ' … [recortado: ' + valor.length + ' caracteres en origen]';
    var corte = LIMITE_CELDA - aviso.length;
    var c = valor.charCodeAt(corte - 1);
    if (c >= 0xD800 && c <= 0xDBFF) corte--;
    return valor.slice(0, corte) + aviso;
  }

  /* Un valor de la fila -> celda, con las conversiones de QareExportar.Valor
     para que los dos libros digan lo mismo: numero = numero, bit = 1/0,
     fecha 'aaaa-mm-ddThh:mm:ss' (SqlRowMapper) -> 'aaaa-mm-dd hh:mm:ss', el
     resto texto tal cual. */
  var ISO_FECHA_HORA = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/;
  function valorExport(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v ? 1 : 0;
    var s = String(v);
    var m = ISO_FECHA_HORA.exec(s);
    return ajustarCelda(m ? m[1] + ' ' + m[2] : s);
  }

  function listaFiltro(filtros, clave) {
    var v = valoresFiltro(filtros, clave);
    return v.length ? v.join(', ') : 'Todos';
  }

  var NUM_EXPORT = new Intl.NumberFormat('es-MX');

  // Cabecera del libro: la de QARE, con el rango de QA (Fecha de registro).
  function metaExport(fi, ff, filtros, total, ahora) {
    return [
      ['Periodo (Fecha de registro)', fi + ' a ' + ff],
      ['Servicio / C1', listaFiltro(filtros, 'c1')],
      ['Grupos', listaFiltro(filtros, 'grupos')],
      ['Lideres', listaFiltro(filtros, 'lideres')],
      ['Total de tickets', NUM_EXPORT.format(total)],
      ['Exportado', ahora],
    ];
  }

  function nombreExport(fi, ff, filtros) {
    return 'QA_' + fi + '_a_' + ff + (hayFiltroOrg(filtros) ? '_filtrado' : '') + '.xlsx';
  }

  /* ---- Formato del libro: el de "⬇ Descargar QARE" (qare/qare.js, LIBRO),
     que a su vez es el de "Descargar Tickets" de Experiencia. Mismo metodo:
     SheetJS arma el libro con los valores y despues se sustituyen
     xl/styles.xml y se retoca xl/worksheets/sheet1.xml (panel congelado y un
     s="i" por celda). Ni un valor cambia. ---- */
  var LIBRO = (function () {
    var VERDE = 'FF166534', VERDE_TENUE = 'FFE7F3EC';
    var AMBAR = 'FF92400E', AMBAR_TENUE = 'FFFDF3E3';
    var ROJO = 'FF991B1B', ROJO_TENUE = 'FFFCE9E9';
    var TINTA = 'FF111827', TINTA_SUAVE = 'FF6B7280';
    var ZEBRA = 'FFF3F6F4', LINEA = 'FFE2E6E4';

    var E = {
      BASE: 0, TITULO: 1, SUBTITULO: 2, META_ETIQUETA: 3, META_VALOR: 4,
      META_FUERTE: 5, ENCABEZADO: 6, CELDA: 7, CELDA_ZEBRA: 8,
      CELDA_LARGA: 9, CELDA_LARGA_ZEBRA: 10,
      ESTADO_VERDE: 11, ESTADO_AMBAR: 12, ESTADO_ROJO: 13,
    };

    function fuente(attrs) { return '<font>' + attrs + '<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'; }
    function relleno(color) { return '<fill><patternFill patternType="solid"><fgColor rgb="' + color + '"/><bgColor indexed="64"/></patternFill></fill>'; }

    function hojaEstilos() {
      var fuentes = [
        fuente('<sz val="11"/><color rgb="' + TINTA + '"/>'),
        fuente('<b/><sz val="16"/><color rgb="' + TINTA + '"/>'),
        fuente('<sz val="10"/><color rgb="' + TINTA_SUAVE + '"/>'),
        fuente('<b/><sz val="10"/><color rgb="' + TINTA_SUAVE + '"/>'),
        fuente('<sz val="10"/><color rgb="' + TINTA + '"/>'),
        fuente('<b/><sz val="11"/><color rgb="FFFFFFFF"/>'),
        fuente('<b/><sz val="10"/><color rgb="' + VERDE + '"/>'),
        fuente('<b/><sz val="11"/><color rgb="' + VERDE + '"/>'),
        fuente('<b/><sz val="11"/><color rgb="' + AMBAR + '"/>'),
        fuente('<b/><sz val="11"/><color rgb="' + ROJO + '"/>'),
      ];
      var rellenos = [
        '<fill><patternFill patternType="none"/></fill>',
        '<fill><patternFill patternType="gray125"/></fill>',
        relleno(VERDE), relleno(ZEBRA), relleno(VERDE_TENUE),
        relleno(AMBAR_TENUE), relleno(ROJO_TENUE),
      ];
      var lado = '<left style="thin"><color rgb="' + LINEA + '"/></left>'
        + '<right style="thin"><color rgb="' + LINEA + '"/></right>'
        + '<top style="thin"><color rgb="' + LINEA + '"/></top>'
        + '<bottom style="thin"><color rgb="' + LINEA + '"/></bottom><diagonal/>';
      var bordes = [
        '<border><left/><right/><top/><bottom/><diagonal/></border>',
        '<border>' + lado + '</border>',
      ];
      // [numFmt, fuente, relleno, borde, alineacion]
      var xfs = [
        [0, 0, 0, 0, ''],
        [0, 1, 0, 0, '<alignment vertical="center"/>'],
        [0, 2, 0, 0, '<alignment vertical="center"/>'],
        [0, 3, 0, 0, '<alignment vertical="center"/>'],
        [0, 4, 0, 0, '<alignment vertical="center"/>'],
        [0, 6, 0, 0, '<alignment vertical="center"/>'],
        [0, 5, 2, 1, '<alignment vertical="center" wrapText="1"/>'],
        [0, 0, 0, 1, '<alignment vertical="top"/>'],
        [0, 0, 3, 1, '<alignment vertical="top"/>'],
        [0, 0, 0, 1, '<alignment vertical="top" wrapText="1"/>'],
        [0, 0, 3, 1, '<alignment vertical="top" wrapText="1"/>'],
        [0, 7, 4, 1, '<alignment vertical="top"/>'],
        [0, 8, 5, 1, '<alignment vertical="top"/>'],
        [0, 9, 6, 1, '<alignment vertical="top"/>'],
      ];
      var xf = xfs.map(function (x) {
        return '<xf numFmtId="' + x[0] + '" fontId="' + x[1] + '" fillId="' + x[2] + '"'
          + ' borderId="' + x[3] + '" xfId="0" applyFont="1" applyFill="1" applyBorder="1"'
          + (x[4] ? ' applyAlignment="1">' + x[4] + '</xf>' : '/>');
      }).join('');
      return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        + '<fonts count="' + fuentes.length + '">' + fuentes.join('') + '</fonts>'
        + '<fills count="' + rellenos.length + '">' + rellenos.join('') + '</fills>'
        + '<borders count="' + bordes.length + '">' + bordes.join('') + '</borders>'
        + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        + '<cellXfs count="' + xfs.length + '">' + xf + '</cellXfs>'
        + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
        + '<dxfs count="0"/>'
        + '<tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>'
        + '</styleSheet>';
    }

    // Semaforo del Estado, y solo del Estado, con las reglas de QARE.
    function estiloEstado(valor) {
      var v = String(valor || '').toLowerCase();
      if (!v) return null;
      if (/(cerrad|resuelt|solucionad|finalizad|complet)/.test(v)) return E.ESTADO_VERDE;
      if (/(cancelad|rechazad|reabiert|escalad)/.test(v)) return E.ESTADO_ROJO;
      if (/(pendiente|espera|proceso|curso|asignad|abiert|nuev)/.test(v)) return E.ESTADO_AMBAR;
      return null;
    }

    function estiloDe(fila, col, d) {
      if (fila === 0) return col === 0 ? E.TITULO : E.BASE;
      if (fila >= d.filaMeta && fila < d.filaMeta + d.nMeta) {
        if (col === 0) return E.META_ETIQUETA;
        return fila === d.filaFuerte ? E.META_FUERTE : E.META_VALOR;
      }
      if (fila === d.filaEncabezado) return E.ENCABEZADO;
      if (fila > d.filaEncabezado) {
        var zebra = (fila - d.filaEncabezado) % 2 === 0;
        if (col === d.colEstado) {
          var propio = estiloEstado(d.valorEstado(fila));
          if (propio !== null) return propio;
        }
        if (d.largas.indexOf(col) >= 0) return zebra ? E.CELDA_LARGA_ZEBRA : E.CELDA_LARGA;
        return zebra ? E.CELDA_ZEBRA : E.CELDA;
      }
      return E.BASE;
    }

    function aBytes(texto) {
      var b = new Uint8Array(texto.length);
      for (var i = 0; i < texto.length; i++) b[i] = texto.charCodeAt(i) & 255;
      return b;
    }
    function aTexto(contenido) {
      var s = '';
      for (var i = 0; i < contenido.length; i++) s += String.fromCharCode(contenido[i]);
      return s;
    }

    function retocarHoja(xml, d) {
      var primeraDatos = d.filaEncabezado + 2;   // 1-based, tras el encabezado
      var pane = '<sheetView workbookViewId="0">'
        + '<pane ySplit="' + (primeraDatos - 1) + '" topLeftCell="A' + primeraDatos + '"'
        + ' activePane="bottomLeft" state="frozen"/>'
        + '<selection pane="bottomLeft" activeCell="A' + primeraDatos + '" sqref="A' + primeraDatos + '"/>'
        + '</sheetView>';
      var salida = xml.replace('<sheetView workbookViewId="0"/>', pane);
      return salida.replace(/<c r="([A-Z]+)(\d+)"/g, function (todo, letras, numero) {
        var col = 0;
        for (var i = 0; i < letras.length; i++) col = col * 26 + (letras.charCodeAt(i) - 64);
        var estilo = estiloDe(parseInt(numero, 10) - 1, col - 1, d);
        return estilo ? todo + ' s="' + estilo + '"' : todo;
      });
    }

    function formatear(XLSX, libro, d) {
      var zip = XLSX.CFB.read(XLSX.write(libro, { type: 'binary', bookType: 'xlsx' }), { type: 'binary' });
      XLSX.CFB.utils.cfb_add(zip, '/xl/styles.xml', aBytes(hojaEstilos()));
      var hojaXml = XLSX.CFB.find(zip, '/xl/worksheets/sheet1.xml');
      XLSX.CFB.utils.cfb_add(zip, '/xl/worksheets/sheet1.xml', aBytes(retocarHoja(aTexto(hojaXml.content), d)));
      return XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
    }

    return { formatear: formatear, estiloEstado: estiloEstado, ESTILOS: E };
  })();

  // Anchos: el de la tabla, o lo que pida la palabra mas larga del
  // encabezado / la etiqueta de metadato mas larga en la columna A.
  function anchosExport(meta) {
    return COLUMNAS_EXPORT.map(function (c, i) {
      var palabra = c[1].split(' ').reduce(function (m, p) { return Math.max(m, p.length); }, 0);
      var minimo = palabra + 3;
      if (i === 0) meta.forEach(function (m) { minimo = Math.max(minimo, String(m[0]).length + 2); });
      return Math.max(c[2], minimo);
    });
  }

  /* Filas de qa.ashx -> bytes del .xlsx, con la misma hoja que QARE: titulo,
     metadatos, encabezado con autofiltro y los tickets. `XLSX` entra por
     parametro para que la prueba le pase el mismo vendor. */
  function libroExport(XLSX, tickets, meta) {
    var aoa = [['QA — Tickets'], []];
    var filaMeta = aoa.length;
    meta.forEach(function (m) { aoa.push([m[0], m[1]]); });
    aoa.push([]);
    var filaEncabezado = aoa.length;
    aoa.push(COLUMNAS_EXPORT.map(function (c) { return c[1]; }));
    tickets.forEach(function (t) {
      aoa.push(COLUMNAS_EXPORT.map(function (c) { return valorExport(t[c[0]]); }));
    });
    var ultimaCol = COLUMNAS_EXPORT.length - 1;
    var hoja = XLSX.utils.aoa_to_sheet(aoa);
    hoja['!cols'] = anchosExport(meta).map(function (w) { return { wch: w }; });
    var altos = [];
    altos[0] = { hpt: 26 };
    altos[filaEncabezado] = { hpt: 46 };
    hoja['!rows'] = altos;
    hoja['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: ultimaCol } }];
    hoja['!autofilter'] = { ref: XLSX.utils.encode_range({
      s: { r: filaEncabezado, c: 0 }, e: { r: aoa.length - 1, c: ultimaCol } }) };
    var libro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(libro, hoja, 'Tickets QA');

    var llaves = COLUMNAS_EXPORT.map(function (c) { return c[0]; });
    var colEstado = llaves.indexOf('Estado');
    return LIBRO.formatear(XLSX, libro, {
      filaEncabezado: filaEncabezado,
      filaMeta: filaMeta,
      nMeta: meta.length,
      filaFuerte: filaMeta + meta.map(function (m) { return m[0]; }).indexOf('Total de tickets'),
      largas: LARGAS_EXPORT.map(function (k) { return llaves.indexOf(k); }),
      colEstado: colEstado,
      valorEstado: function (fila) {
        var f = aoa[fila];
        return f ? f[colEstado] : '';
      },
    });
  }

  raiz.QaDatos = {
    diaMexico: diaMexico, rangoRapido: rangoRapido, DIAS_POR_OMISION: DIAS_POR_OMISION,
    FILTROS_ORG: FILTROS_ORG, hayFiltroOrg: hayFiltroOrg, esPorOmision: esPorOmision,
    parametrosVista: parametrosVista,
    COLUMNAS_EXPORT: COLUMNAS_EXPORT, LARGAS_EXPORT: LARGAS_EXPORT, LIMITE_CELDA: LIMITE_CELDA,
    ajustarCelda: ajustarCelda, valorExport: valorExport, metaExport: metaExport,
    nombreExport: nombreExport, libroExport: libroExport, LIBRO: LIBRO,
  };

  // ============================================================ 2. tablero
  if (typeof document === 'undefined') return;

  /* El handler cuelga de la raiz del sitio, pero este script se carga desde
     dos sitios distintos: qa/qa.html (la pagina suelta) y dashboard.html, que
     lo inyecta con src="qa/qa.js". Resolver la ruta contra la URL del propio
     script da handlers/qa.ashx en la raiz en los dos casos. */
  var API = (function () {
    var yo = document.currentScript && document.currentScript.src;
    try { return new URL('../handlers/qa.ashx', yo).href; }
    catch (e) { return 'handlers/qa.ashx'; }
  })();
  /* Las listas de Servicio / Grupos / Lideres: las de QARE y el Backlog. Y
     el SheetJS de la descarga, el mismo vendor que QARE y Experiencia. Las
     dos rutas se fijan aqui porque document.currentScript solo vale
     mientras el script se evalua. */
  var API_CATALOGOS = (function () {
    var yo = document.currentScript && document.currentScript.src;
    try { return new URL('../handlers/backlog_catalogos.ashx', yo).href; }
    catch (e) { return 'handlers/backlog_catalogos.ashx'; }
  })();
  var XLSX_URL = (function () {
    var yo = document.currentScript && document.currentScript.src;
    try { return new URL('../experiencia/vendor/xlsx.mini.min.js', yo).href; }
    catch (e) { return 'experiencia/vendor/xlsx.mini.min.js'; }
  })();

  /* Todos los ids del marcado llevan el prefijo "qa-". En el tablero este
     modulo comparte documento con SLA y Backlog, que ya tienen su propio
     #kpis: sin prefijo, getElementById devolveria el bloque equivocado. El
     prefijo se resuelve en $() y no en cada llamada. */
  var PREFIJO = 'qa-';

  // Las dos graficas de barras muestran el mismo numero de filas para que las
  // dos tarjetas midan igual. El recorte es de presentacion: el API sigue
  // mandando la lista completa y el top se recalcula en cada pintado.
  var TOP_BARRAS = 10;

  var NUM = new Intl.NumberFormat('es-MX');
  var NUM2 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /* Colores de este tablero. Hay DOS sistemas y no se mezclan:

     - MAGNITUD (las dos barras, Grupo y Tecnico): las dos son un TOP 10 de
       una sola serie, asi que las dos llevan el azul de barra ordinaria
       compartido, Paleta.AZUL_SERIE. Antes la de Tecnico iba de otro color
       -la posicion 2 de la paleta- y eso sugeria que Grupo y Tecnico median
       cosas distintas: miden lo mismo, incidencias, sobre otra dimension.
       El azul sale de la paleta COMPARTIDA, assets/js/paleta.js ->
       window.Paleta; no se copia ningun color aqui. Embebido en
       dashboard.html este modulo pierde sus <script> y usa la copia que ya
       cargo dashboard.html; suelto, la carga qa.html.

     - ESTADO de validacion (OK / Incorrecto / Valido / Sin catalogo): es
       semantico y se queda como esta. El rojo sigue reservado para
       "Incorrecto" y no se usa en ningun otro sitio del tablero.

     Los nombres de las claves son heredados y ya NO describen su color: se
     conservan para no tocar la logica que los cita. */
  var COLOR = {
    azul: Paleta.AZUL_SERIE,     // las dos barras de ranking (grupo y tecnico)
    azulOscuro: '#1d4ed8',       // hover de barra: la primaria, mas profunda
    verde: '#5aa726',            // estado OK
    rojo: '#982a18',             // estado Incorrecto (unico uso del rojo)
    ambar: '#b09512',            // estado Sin catalogo: mostaza, no ambar semantico
    cyan: '#2f8f6b',             // estado Valido: verde pino
    gris: Paleta.NEUTRO          // fuera de catalogo: neutro
  };
  // Tinta de ejes, etiquetas y rejilla: carbon y gris verdoso.
  var TINTA = { eje: '#5e5e5f', etiqueta: '#393939', rejilla: '#eef1ea' };

  // Color por estado de validacion. Un estado que no este en la lista recibe
  // un color neutro, pero conserva su nombre: nunca se agrupa con otro.
  var COLOR_VALIDACION = {
    'OK': COLOR.verde,
    'Incorrecto': COLOR.rojo,
    'Valido': COLOR.cyan,
    'Sin catalogo': COLOR.ambar
  };

  var estado = {
    resumen: null,
    filtros: { validacion: 'Incorrecto', grupo: null, tecnico: null, grupoCorrecto: null },
    pagina: 1,
    tamano: 100,
    total: 0,
    detalleAbierto: false,
    peticionDetalle: 0,
    peticionResumen: 0,
    // Lo que eligieron los filtros de arriba: { inicio, fin, filtros }, y el
    // rango por omision contra el que se compara (ver esPorOmision).
    vista: null,
    defecto: null,
    // Las dos graficas de Top 10 (ver pintarBase): true cuando ya se
    // pintaron con la carga por omision. Despues nada las vuelve a tocar.
    baseLista: false,
    basePidiendo: false
  };

  var graficas = { grupo: null, tecnico: null, validacion: null };

  // ---------------------------------------------------------------- utiles
  function $(id) { return document.getElementById(PREFIJO + id); }

  function esc(valor) {
    if (valor === null || valor === undefined) return '';
    return String(valor)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // Un nulo del origen se muestra como nulo, no se sustituye por un valor real.
  function celdaNula(texto) {
    return '<span class="nulo">' + esc(texto) + '</span>';
  }

  function fechaCorta(iso) {
    if (!iso || typeof iso !== 'string') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
    return m ? m[3] + '/' + m[2] + '/' + m[1] : null;
  }

  function fechaHora(iso) {
    if (!iso || typeof iso !== 'string') return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})/.exec(iso);
    if (m) return m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4];
    return fechaCorta(iso) || iso;
  }

  function recortar(texto, tope) {
    if (texto === null || texto === undefined) return '';
    texto = String(texto);
    return texto.length > tope ? texto.slice(0, tope - 1) + '…' : texto;
  }

  // ------------------------------------------- estados de carga por bloque
  // Cada bloque se apaña solo: muestra su propio "Calculando...", su "sin
  // datos" o su error, sin que ninguno pueda dejar la pagina en blanco.

  // Aviso encima de un lienzo. texto null lo quita y deja ver la grafica.
  function mensajeLienzo(id, texto, clase) {
    var caja = $(id);
    if (!caja) return;
    if (!texto) { caja.hidden = true; return; }
    caja.className = 'lienzo-msg' + (clase ? ' ' + clase : '');
    caja.textContent = texto;
    caja.hidden = false;
  }

  function filaTabla(id, columnas, texto, clase) {
    $(id).innerHTML = '<tr><td colspan="' + columnas + '" class="vacio">' +
      (clase ? '<span class="' + clase + '">' + esc(texto) + '</span>' : esc(texto)) +
      '</td></tr>';
  }

  // Las tarjetas de KPI de la pagina recien abierta: las mismas cinco, con su
  // titulo, su nota y su color definitivos, y una raya en lugar del numero.
  // Asi el bloque ocupa desde el principio el alto que va a ocupar.
  var KPIS = [
    ['kpi-azul',  'Total tickets',               'Suma ultimos 15 dias'],
    ['kpi-rojo',  'Tickets incorrectos',         'Validacion = Incorrecto (suma 15 dias)'],
    ['kpi-ambar', '% incorrectos',               'Sobre el total del rango'],
    ['kpi-rojo',  'Incorrectos ayer',            'Por fecha de firma de solucion'],
    ['kpi-azul',  'Incorrectos semana anterior', 'Por fecha de firma de solucion']
  ];

  function kpisEnEspera(valor) {
    estado.kpis = null;
    $('kpis').innerHTML = KPIS.map(function (k) {
      return tarjeta(k[0] + ' kpi-espera', k[1], valor, k[2]);
    }).join('');
  }

  // Arma la pagina COMPLETA antes de pedir un solo dato: tarjetas, graficas
  // vacias en su sitio, tablas con su aviso y los controles listos. Lo que
  // llegue despues rellena estos componentes; no los crea.
  function armarShell() {
    kpisEnEspera('—');

    /* Geometria de barra del juego COMPARTIDO (assets/js/barras.js) como
       DEFAULT del tipo `bar`, igual que hacen dashboard.js y experiencia.js.
       Antes este modulo no lo llamaba y tenia que copiar Barras.GRUESA y
       Barras.RADIO dentro de su dataset. Es idempotente: cuando QA va
       embebido en dashboard.html el tablero ya lo llamo. */
    Barras.aplicarDefaults();

    // Alto de partida: el definitivo lo pone cada bloque cuando sabe cuantas
    // barras tiene. Sin esto la tarjeta nace plana y salta al llegar los datos.
    $('lienzo-grupo').style.height = altoLienzo(TOP_BARRAS);
    $('lienzo-tecnico').style.height = altoLienzo(TOP_BARRAS);

    graficas.grupo = crearBarras('chart-grupo', COLOR.azul, function (etiqueta) {
      if (etiqueta === '(sin grupo)') return;
      aplicarFiltro('grupo', etiqueta);
    });
    graficas.tecnico = crearBarras('chart-tecnico', COLOR.azul, function (etiqueta) {
      aplicarFiltro('tecnico', etiqueta);
    });
    graficas.validacion = crearDona();

    filaTabla('tbody-recat', 3, 'Calculando…');
    pintarFiltros();
  }

  // El resumen de la vista no llego: cada bloque que sigue a los filtros lo
  // dice en su sitio y el resto de la pagina se queda como esta. Las dos
  // graficas no: son de la carga por omision (ver baseFallo).
  function faseUnoFallo(mensaje) {
    kpisEnEspera('n/d');
    filaTabla('tbody-recat', 3, mensaje);
  }

  // La carga por omision no llego y las graficas no tienen con que pintarse.
  function baseFallo() {
    mensajeLienzo('msg-grupo', 'Error al cargar datos.', 'lienzo-msg-error');
    mensajeLienzo('msg-tecnico', 'Error al cargar datos.', 'lienzo-msg-error');
  }

  // ------------------------------------------------------------------ API
  // Mensajes de error siempre en terminos de usuario: nada de rutas, stacks
  // ni detalles del servidor, vengan de donde vengan.
  function pedir(parametros) {
    var url = API + '?' + Object.keys(parametros)
      .filter(function (k) { return parametros[k] !== null && parametros[k] !== undefined && parametros[k] !== ''; })
      .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(parametros[k]); })
      .join('&');

    return fetch(url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (respuesta) {
        return respuesta.text().then(function (texto) {
          var datos = null;
          if (texto && texto.trim() !== '') {
            try { datos = JSON.parse(texto); }
            catch (e) { datos = null; }
          }

          if (!respuesta.ok) {
            // El handler responde su propio JSON de error; si llega otra cosa
            // (por ejemplo una pagina HTML de IIS), se usa un texto generico.
            var msg = (datos && typeof datos.message === 'string')
              ? datos.message
              : 'El servidor respondio con el codigo ' + respuesta.status + '.';
            // El estado viaja aparte: con 401 / 403 el refresco se detiene.
            var e = new Error(msg);
            e.estado = respuesta.status;
            throw e;
          }
          if (datos === null) {
            throw new Error('La respuesta del servidor llego vacia o con un formato no valido.');
          }
          if (datos && datos.error === true) {
            throw new Error(typeof datos.message === 'string' ? datos.message : 'El servidor reporto un error.');
          }
          return datos;
        });
      })
      .catch(function (err) {
        if (err instanceof TypeError) {
          throw new Error('No se pudo contactar a qa.ashx. Revisa que el sitio este publicado y en ejecucion.');
        }
        throw err;
      });
  }

  // -------------------------------------------------------------- resumen
  /* fondo = refresco (el automatico de dashboard.js o "Actualizar"): la
     misma vista y las mismas peticiones, sin "Calculando…" y, si algo falla,
     lo que se ve se queda y la pastilla lo avisa. Las dos graficas de Top 10
     tambien se refrescan (siguen siendo de la carga por omision, ver
     pintarBase). -> Promise (null, o el estado HTTP de un fallo). */
  var resumenEnVuelo = 0, cargadoUnaVez = false;
  function cargarResumen(fondo) {
    fondo = fondo === true;
    if (!fondo) $('error-global').hidden = true;

    // qa.ashx solo existe si un servidor lo ejecuta. Abierta desde el disco la
    // pagina no tiene origen HTTP y el fetch muere en CORS: mejor decirlo. El
    // tablero se queda en pantalla, con sus bloques marcados sin datos.
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      if (fondo) return Promise.resolve(null);
      faseUnoFallo('Sin servidor.');
      if (!estado.baseLista) baseFallo();
      mensajeLienzo('msg-validacion', 'Sin servidor.', 'lienzo-msg-error');
      $('error-global-msg').textContent =
        'Esta pagina necesita el servidor: abrela en ' +
        'http://localhost:8080/qa/qa.html (la publica dev-qa.cmd), en la pestaña ' +
        'QA del tablero o en el sitio publicado en IIS. Los datos se consultan a ' +
        'la base desde el servidor, no desde el navegador.';
      $('error-global').hidden = false;
      return Promise.resolve(null);
    }

    // Mismo control que QARE: un rango al reves no sale a la red.
    var vista = estado.vista;
    if (!vista.inicio || !vista.fin || vista.inicio > vista.fin) {
      // En fondo un rango a medio escribir no se toca: se espera al usuario.
      if (fondo) return Promise.resolve(null);
      ++estado.peticionResumen;   // lo que estuviera en vuelo ya no pinta
      var msg = 'Rango de fechas invalido: la fecha inicio debe ser anterior o igual a la fecha fin.';
      faseUnoFallo(msg);
      if (!estado.baseLista && !estado.basePidiendo) cargarBase();
      $('error-global-msg').textContent = msg;
      $('error-global').hidden = false;
      return Promise.resolve(null);
    }

    // Si el usuario recarga varias veces seguidas, solo la ultima peticion
    // puede tocar la pantalla: una respuesta vieja que llegue tarde no debe
    // reactivar el spinner ni el mensaje de error.
    var token = ++estado.peticionResumen;
    var params = parametrosVista(vista, estado.defecto);
    var rango = { inicio: vista.inicio, fin: vista.fin };

    // Lo que sigue a los filtros vuelve a "Calculando"; las graficas no. Un
    // refresco no: lo de antes se ve hasta que llegue lo nuevo.
    if (!fondo) {
      kpisEnEspera('—');
      filaTabla('tbody-recat', 3, 'Calculando…');
      esperandoCompleto();
    }

    /* La vista por omision es la misma peticion de siempre y de ella salen
       tambien las dos graficas: no se pide dos veces. Con otra vista las
       graficas van por su cuenta (cargarBase): una sola vez al abrir y una
       vez en cada refresco. */
    var porOmision = esPorOmision(vista, estado.defecto);
    var alimentaBase = porOmision && (fondo || !estado.baseLista);
    var base = null;
    if (alimentaBase) estado.basePidiendo = true;
    else if (fondo) base = cargarBase(true);
    else if (!estado.baseLista && !estado.basePidiendo) cargarBase();

    resumenEnVuelo++;
    var resumen = pedir(Object.assign({ action: 'summary' }, params))
      .then(function (datos) {
        if (!datos.summary || !datos.source) {
          throw new Error('La respuesta no contiene la informacion de resumen esperada.');
        }
        if (alimentaBase) pintarBase(datos, fondo);
        if (token !== estado.peticionResumen) return null;
        // La vista por omision la decide el servidor: si en un refresco su
        // rango ya es otro (cambio el dia), las cifras son de ese rango.
        var s = datos.source || {};
        if (fondo && porOmision && s.fechaInicio && s.fechaFin) rango = { inicio: s.fechaInicio, fin: s.fechaFin };
        estado.resumen = datos;
        cargadoUnaVez = true;
        $('error-global').hidden = true;
        return pintarTablero(datos, params, rango, fondo);
      })
      .catch(function (err) {
        if (alimentaBase) { estado.basePidiendo = false; if (!estado.baseLista) baseFallo(); }
        if (token !== estado.peticionResumen) return null;
        if (fondo && cargadoUnaVez) {
          avisoRefresco(err);
          return err.estado || null;
        }
        // El aviso va arriba, como banda, y el tablero sigue en pantalla: los
        // bloques que no dependen de esta peticion no tienen por que
        // desaparecer.
        faseUnoFallo(err.message);
        $('error-global-msg').textContent = err.message;
        $('error-global').hidden = false;
        return err.estado || null;
      })
      .then(function (r) { resumenEnVuelo--; return r; });
    return base ? Promise.all([resumen, base]).then(function (r) { return r[0]; }) : resumen;
  }

  // Un refresco que fallo: lo de antes se queda y la pastilla lo dice.
  function avisoRefresco(err) {
    DatosInfo.avisoRefresco($('chip-fecha'), '⚠ No se pudo actualizar (' +
      DatosInfo.fechaHora(DatosInfo.ahoraLocal()) + '); se muestran los datos anteriores', err.message);
    console.error('[QA]', err);
  }

  /* Las dos graficas de Top 10 cuando la vista NO es la de por omision y
     todavia no se pintaron (un filtro puesto antes de que llegara la primera
     carga, o la primera carga fallo y se reintenta con filtros). Es la misma
     peticion por omision de siempre, y solo pinta las graficas. En un
     refresco las repinta; si falla, se quedan las de antes. -> Promise. */
  function cargarBase(refresco) {
    estado.basePidiendo = true;
    return pedir({ action: 'summary' })
      .then(function (datos) { pintarBase(datos, refresco === true); })
      .catch(function () { estado.basePidiendo = false; if (!estado.baseLista) baseFallo(); });
  }

  /* UNICO sitio que pinta las dos graficas: con la carga por omision (los 15
     dias de siempre, sin filtros), una vez al abrir y otra en cada refresco
     (refrescar). Ni los filtros, ni Limpiar, ni Reintentar las repintan; asi
     no cambian con nada de arriba. */
  function pintarBase(datos, refresco) {
    if (estado.baseLista && !refresco) return;
    estado.baseLista = true;
    estado.basePidiendo = false;
    pintarGrupo(datos.porGrupo || []);
    pintarTecnico(datos.porTecnico || []);
    /* El servidor decide el rango por omision. Si el reloj de esta maquina
       lo calculo distinto, manda el del servidor: las fechas de arriba y el
       "por omision" pasan a ser los suyos mientras no se haya tocado nada. */
    var s = datos.source || {};
    if (s.fechaInicio && s.fechaFin && esPorOmision(estado.vista, estado.defecto) &&
        (s.fechaInicio !== estado.defecto.inicio || s.fechaFin !== estado.defecto.fin)) {
      estado.defecto = { inicio: s.fechaInicio, fin: s.fechaFin };
      ponerFechas(estado.defecto.inicio, estado.defecto.fin);
      leerVista();
    }
  }

  // params: los de la vista, para que la distribucion por estado pida lo
  // mismo que el resumen. -> Promise (la segunda fase) o null.
  function pintarTablero(datos, params, rango, fondo) {
    /* Pastilla de la cabecera: "Última actualización" y "Periodo" de
       datos.dataInfo (el sello es el fin del ultimo ETL en dbo.EtlLog, via
       qa.ashx), y "Consultado": la hora de esta respuesta buena. El resto de
       la procedencia (datos.source: origen, tickets en el rango, vista,
       consultado) ya no se muestra; sigue llegando por compatibilidad. */
    DatosInfo.pintar($('chip-fecha'), datos.dataInfo, { consultado: DatosInfo.ahoraLocal() });
    pintarKpis(datos.summary, datos.historico, rango);
    // porGrupo / porTecnico de esta respuesta no se pintan: las graficas son
    // de la carga por omision (pintarBase).
    pintarRecategorizacion(datos.recategorizacion || []);

    // El corte por estado es el unico bloque que necesita recorrer TODOS los
    // tickets del rango y no solo los incorrectos, y ese recorrido es lo que
    // tarda. El resumen ya no espera por el: el servidor lo manda como null,
    // aqui se pinta un aviso y llega en una segunda peticion. Todo lo demas ya
    // esta en pantalla.
    if (datos.validacion === null) {
      if (!fondo) esperandoCompleto();
      return cargarCompleto(params, fondo);
    }
    pintarValidacion(datos.validacion || []);
    return null;
  }

  function esperandoCompleto() {
    $('hint-validacion').textContent = '';
    $('leyenda-validacion').innerHTML = '';
    mensajeLienzo('msg-validacion', 'Calculando la distribucion por estado…');
  }

  // Segunda peticion. La respuesta trae ademas los contadores QA/QARE y el top
  // de categorias; hoy solo se pinta la distribucion por estado. En un
  // refresco que falla se queda la dona de antes. -> Promise (null).
  function cargarCompleto(params, fondo) {
    var token = estado.peticionResumen;

    return pedir(Object.assign({ action: 'qare' }, params))
      .then(function (datos) {
        if (token !== estado.peticionResumen) return null;   // hubo otra recarga
        pintarValidacion(datos.validacion || []);
        return null;
      })
      .catch(function (err) {
        // Falla solo esta fase: los KPIs, las dos graficas de barras y la
        // recategorizacion ya estan en pantalla y ahi se quedan.
        if (token !== estado.peticionResumen) return null;
        if (fondo) { avisoRefresco(err); return null; }
        mensajeLienzo('msg-validacion', 'Error al cargar datos.', 'lienzo-msg-error');
        $('leyenda-validacion').innerHTML = '<div class="vacio">' + esc(err.message) + '</div>';
        return null;
      });
  }


  // ----------------------------------------------------------------- KPIs
  /* "Tickets incorrectos" abre el detalle con Validacion = Incorrecto, lo
     mismo que cuenta: un clic lo pone (sin tocar Grupo, Tecnico ni Grupo
     correcto), otro clic lo quita y el detalle lista todos los estados del
     rango, como la × de la etiqueta "Validacion". El estado es el de
     siempre, estado.filtros.validacion: SeleccionKpi pone la mecanica, asi
     que la dona y la × tambien mueven la marca. Las cifras no cambian.
     Las demas tarjetas no abren nada: Total tickets listaria toda la vista
     (qa.ashx solo resuelve en SQL el filtro Incorrecto), el % es un
     cociente, y ayer / semana anterior son un dia que el detalle no sabe
     filtrar. */
  var KPI_INCORRECTOS = 'incorrectos';
  var SK = window.SeleccionKpi;
  var seleccion = SK ? new SK({ valida: function (k) { return k === KPI_INCORRECTOS; } }) : null;
  function marcarDesdeDetalle() {
    if (seleccion) seleccion.clave = estado.detalleAbierto && estado.filtros.validacion === 'Incorrecto' ? KPI_INCORRECTOS : '';
  }

  // k: la clave de la tarjeta que abre el detalle.
  function tarjeta(clase, titulo, valor, nota, k) {
    var filtra = !!(k && seleccion);
    return '<div class="kpi ' + clase + (filtra ? seleccion.clases(k) : '') + '">' +
      '<div class="kpi-tit">' + esc(titulo) + '</div>' +
      '<div class="kpi-val">' + esc(valor) + '</div>' +
      (nota ? '<div class="kpi-nota">' + esc(nota) + '</div>' : '') +
      (filtra ? seleccion.boton(k, titulo + ': ' + valor, 'Ver el detalle de los incorrectos') : '') +
      '</div>';
  }

  function repintarKpis() {
    if (estado.kpis) pintarKpis(estado.kpis.resumen, estado.kpis.historico, estado.kpis.rango);
  }

  // rango: el periodo de ESTAS cifras ({ inicio, fin }); por omision, el de
  // la vista con la que se pidieron.
  function pintarKpis(resumen, historico, rango) {
    rango = rango || (estado.vista ? { inicio: estado.vista.inicio, fin: estado.vista.fin } : null);
    estado.kpis = { resumen: resumen, historico: historico, rango: rango };
    marcarDesdeDetalle();
    var total = resumen.totalTickets;
    var incorrectos = resumen.incorrectos;
    var pct = resumen.incorrectosPct;

    // Con el rango por omision, las notas de siempre; con otro, el periodo.
    var omision = !rango || !estado.defecto ||
      (rango.inicio === estado.defecto.inicio && rango.fin === estado.defecto.fin);
    var periodo = omision ? '' : fechaCorta(rango.inicio) + ' al ' + fechaCorta(rango.fin);

    var html = '';
    html += tarjeta('kpi-azul', 'Total tickets',
      total === undefined ? 'n/d' : NUM.format(total), omision ? 'Suma ultimos 15 dias' : 'Suma del ' + periodo);
    html += tarjeta('kpi-rojo', 'Tickets incorrectos',
      incorrectos === undefined ? 'n/d' : NUM.format(incorrectos),
      omision ? 'Validacion = Incorrecto (suma 15 dias)' : 'Validacion = Incorrecto (suma del periodo)', KPI_INCORRECTOS);
    html += tarjeta('kpi-ambar', '% incorrectos',
      pct === undefined ? 'n/d' : NUM2.format(pct) + '%', 'Sobre el total del rango');

    // Un solo dia cada uno, contado por fecha de firma de solucion. Se omiten
    // si el reporte no trae esa columna.
    if (historico) {
      html += tarjeta('kpi-rojo', 'Incorrectos ayer',
        historico.incorrectosAyer === undefined
          ? 'n/d' : NUM.format(historico.incorrectosAyer),
        fechaCorta(historico.fechaAyer));
      html += tarjeta('kpi-azul', 'Incorrectos semana anterior',
        historico.incorrectosSemanaAnterior === undefined
          ? 'n/d' : NUM.format(historico.incorrectosSemanaAnterior),
        fechaCorta(historico.fechaSemanaAnterior));
    }

    $('kpis').innerHTML = html;
  }

  // ------------------------------------------------------------- graficas
  /* Alto reservado por fila. Las dos graficas son HORIZONTALES: el alto del
     lienzo es lo que decide la ranura de cada barra, y con 26px por fila la
     barra salia de unos 21px por mucho que se le subiera el tope. Con 40 la
     ranura da para la barra gruesa del resto de los tableros (Barras.GRUESA)
     y para que la cifra del final quepa sin encimarse con la vecina. */
  var ALTO_FILA = 40;
  function altoLienzo(n) { return Math.max(240, n * ALTO_FILA + 64) + 'px'; }

  // La grafica se CREA vacia cuando se arma la pagina y despues se rellena en
  // su sitio con pintarBarras. Antes se creaba y se destruia en cada pintado,
  // lo que ademas obligaba a que existieran los datos para que existiera la
  // grafica: la tarjeta no podia verse hasta que respondiera SQL.
  function crearBarras(canvasId, color, alClic) {
    var ctx = $(canvasId).getContext('2d');
    return new Chart(ctx, {
      type: 'bar',
      data: {
        labels: [],
        // Las medidas y el radio ya son el default compartido
        // (Barras.aplicarDefaults, arriba en armarShell): el mismo de SLA,
        // Backlog y Experiencia. Antes este modulo tenia un arreglo propio
        // -tope de 22px y .78/.74 de ranura- que dejaba estas barras mas
        // delgadas que las de al lado.
        datasets: [{
          data: [],
          backgroundColor: color,
          hoverBackgroundColor: COLOR.azulOscuro
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 220 },
        layout: { padding: { right: 26 } },
        // Las etiquetas se leen de la grafica y no de una variable capturada:
        // la lista cambia cada vez que se rellena.
        onClick: function (evento, elementos, grafica) {
          if (alClic && elementos.length) alClic(grafica.data.labels[elementos[0].index]);
        },
        onHover: function (evento, elementos) {
          if (alClic) evento.native.target.style.cursor = elementos.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (item) { return NUM.format(item.parsed.x) + ' tickets'; }
            }
          },
          // La cifra la pinta el plugin COMPARTIDO (ver mas abajo), que no
          // se configura por opciones.
        },
        scales: {
          x: {
            beginAtZero: true,
            ticks: { precision: 0, color: TINTA.eje },
            grid: { color: TINTA.rejilla }
          },
          y: {
            ticks: {
              color: TINTA.etiqueta, autoSkip: false, font: { size: 11.5 },
              callback: function (valor) { return recortar(this.getLabelForValue(valor), 42); }
            },
            grid: { display: false }
          }
        }
      },
      plugins: [ETIQUETAS_DENTRO]
    });
  }

  function pintarBarras(grafica, etiquetas, valores) {
    grafica.data.labels = etiquetas;
    grafica.data.datasets[0].data = valores;
    grafica.update();
  }

  /* La cifra de cada barra: el plugin COMPARTIDO de assets/js/barras.js,
     atado al formateador de este modulo. Aqui vivia `pluginValores`, que la
     pintaba SIEMPRE por fuera de la punta, en gris y con otra fuente; el
     compartido la mete DENTRO de la barra cuando cabe -con tinta de contraste
     contra el relleno- y solo la saca afuera en las barras cortas de la cola.
     El `layout.padding.right` de arriba es justamente el hueco para esas.

     Se crea una sola vez y lo comparten las dos graficas horizontales de la
     pagina: el plugin no guarda estado. */
  var ETIQUETAS_DENTRO = Barras.etiquetasDentro(function (v) { return NUM.format(v); });

  // Top de la lista que manda el API, de mayor a menor. Se recalcula en cada
  // pintado, asi que una recarga o un rango distinto rehacen el top solos.
  function topPorTickets(filas) {
    return filas.slice()
      .sort(function (a, b) { return b.tickets - a.tickets; })
      .slice(0, TOP_BARRAS);
  }

  // Las dos tarjetas conservan el alto de TOP_BARRAS filas que reservo el
  // shell: aunque una lista traiga menos, la tarjeta no encoge y el par sigue
  // midiendo igual.
  function pintarGrupo(filas) {
    if (!filas.length) {
      $('hint-grupo').textContent = '';
      pintarBarras(graficas.grupo, [], []);
      mensajeLienzo('msg-grupo', 'No hay grupos con tickets incorrectos en este rango.');
      return;
    }
    var visibles = topPorTickets(filas);
    $('hint-grupo').textContent = filas.length > visibles.length
      ? 'top ' + visibles.length + ' de ' + filas.length + ' grupos'
      : visibles.length + ' grupos';

    mensajeLienzo('msg-grupo', null);
    pintarBarras(
      graficas.grupo,
      visibles.map(function (f) { return f.grupo === null ? '(sin grupo)' : f.grupo; }),
      visibles.map(function (f) { return f.tickets; })
    );
  }

  function pintarTecnico(filas) {
    if (!filas.length) {
      $('hint-tecnico').textContent = '';
      pintarBarras(graficas.tecnico, [], []);
      mensajeLienzo('msg-tecnico', 'No hay tecnicos con tickets incorrectos en este rango.');
      return;
    }

    var visibles = topPorTickets(filas);
    $('hint-tecnico').textContent = filas.length > visibles.length
      ? 'top ' + visibles.length + ' de ' + filas.length + ' tecnicos'
      : visibles.length + ' tecnicos';

    mensajeLienzo('msg-tecnico', null);
    pintarBarras(
      graficas.tecnico,
      visibles.map(function (f) { return f.tecnico; }),
      visibles.map(function (f) { return f.tickets; })
    );
  }

  // La dona se crea vacia con la pagina; aqui solo se le cambian los datos.
  function crearDona() {
    return new Chart($('chart-validacion').getContext('2d'), {
      type: 'doughnut',
      data: { labels: [], datasets: [{ data: [], backgroundColor: [], borderWidth: 2, borderColor: '#fff' }] },
      options: {
        // Cuadrada de verdad: el lienzo manda el tamano (.lienzo-dona es una
        // caja con aspect-ratio 1) y Chart.js mide lado = lado.
        responsive: true, maintainAspectRatio: true, aspectRatio: 1, cutout: '58%',
        // La dona tambien filtra: clic en un estado = detalle de ese estado.
        onClick: function (evento, elementos, grafica) {
          if (elementos.length) {
            var etiqueta = grafica.data.labels[elementos[0].index];
            if (etiqueta !== '(sin valor)') aplicarFiltro('validacion', etiqueta);
          }
        },
        onHover: function (evento, elementos) {
          evento.native.target.style.cursor = elementos.length ? 'pointer' : 'default';
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: function (item) {
                // El total sale de la propia grafica: los datos cambian
                // despues de crearla.
                var total = item.dataset.data.reduce(function (a, b) { return a + b; }, 0);
                var pct = total ? (item.parsed * 100 / total) : 0;
                return item.label + ': ' + NUM.format(item.parsed) + ' (' + NUM2.format(pct) + '%)';
              }
            }
          }
        }
      }
    });
  }

  function pintarValidacion(filas) {
    if (!filas.length) {
      $('hint-validacion').textContent = '';
      $('leyenda-validacion').innerHTML = '<div class="vacio">Sin datos de validacion.</div>';
      graficas.validacion.data.labels = [];
      graficas.validacion.data.datasets[0].data = [];
      graficas.validacion.update();
      mensajeLienzo('msg-validacion', 'Sin datos de validacion.');
      return;
    }
    var etiquetas = filas.map(function (f) { return f.validacion === null ? '(sin valor)' : f.validacion; });
    var valores = filas.map(function (f) { return f.tickets; });
    var colores = etiquetas.map(function (e) { return COLOR_VALIDACION[e] || COLOR.gris; });
    var total = valores.reduce(function (a, b) { return a + b; }, 0);

    $('hint-validacion').textContent = etiquetas.length + ' estados';

    mensajeLienzo('msg-validacion', null);
    graficas.validacion.data.labels = etiquetas;
    graficas.validacion.data.datasets[0].data = valores;
    graficas.validacion.data.datasets[0].backgroundColor = colores;
    graficas.validacion.update();

    // Leyenda propia: los cuatro estados se listan por separado, nunca se
    // agrupa "Valido" con "OK" ni "Sin catalogo" con "Incorrecto".
    $('leyenda-validacion').innerHTML = filas.map(function (f, i) {
      var pct = f.pct !== undefined ? f.pct : (total ? f.tickets * 100 / total : 0);
      return '<span class="leyenda-item">' +
        '<span class="swatch" style="background:' + colores[i] + '"></span>' +
        esc(etiquetas[i]) +
        ' <span class="leyenda-val">' + NUM.format(f.tickets) + '</span>' +
        ' <span class="leyenda-pct">(' + NUM2.format(pct) + '%)</span></span>';
    }).join('');
  }

  function pintarRecategorizacion(filas) {
    var cuerpo = $('tbody-recat');
    if (!filas.length) {
      cuerpo.innerHTML = '<tr><td colspan="3" class="vacio">Sin pares de recategorizacion.</td></tr>';
      $('hint-recat').textContent = '';
      return;
    }
    var orden = filas.slice().sort(function (a, b) { return b.tickets - a.tickets; });
    $('hint-recat').textContent = orden.length + ' pares';

    cuerpo.innerHTML = orden.map(function (f) {
      // grupoCorrecto nulo en el origen = el ticket no tiene grupo correcto
      // asignado. Se rotula como tal y se deja claro que viene vacio.
      var correcto = (f.grupoCorrecto === null || f.grupoCorrecto === undefined || f.grupoCorrecto === '')
        ? celdaNula('Sin grupo correcto')
        : esc(f.grupoCorrecto);
      return '<tr>' +
        '<td>' + (f.grupo === null ? celdaNula('(sin grupo)') : esc(f.grupo)) + '</td>' +
        '<td>' + correcto + '</td>' +
        '<td class="num">' + NUM.format(f.tickets) + '</td>' +
        '</tr>';
    }).join('');
  }

  // -------------------------------------------------------------- detalle
  // Estado con el que abre el detalle: solo los incorrectos, sin acotar por
  // grupo ni tecnico. Lo fija "Ver detalle de incorrectos" cada vez que se
  // abre la vista.
  function filtrosPorDefecto() {
    return { validacion: 'Incorrecto', grupo: null, tecnico: null, grupoCorrecto: null };
  }

  function aplicarFiltro(nombre, valor) {
    estado.filtros[nombre] = valor;
    estado.pagina = 1;
    cargarDetalle();
    $('detalle-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function pintarFiltros() {
    var etiquetas = {
      validacion: 'Validacion', grupo: 'Grupo',
      tecnico: 'Tecnico', grupoCorrecto: 'Grupo correcto'
    };
    var html = Object.keys(etiquetas)
      .filter(function (k) { return estado.filtros[k]; })
      .map(function (k) {
        return '<span class="filtro">' + esc(etiquetas[k]) + ': ' + esc(estado.filtros[k]) +
          ' <button type="button" data-quitar="' + k + '" title="Quitar filtro">&times;</button></span>';
      }).join('');

    var caja = $('filtros-activos');
    caja.innerHTML = html || '<span class="hint">Sin filtros: se listan todos los tickets del rango, paginados.</span>';
    caja.querySelectorAll('button[data-quitar]').forEach(function (boton) {
      boton.addEventListener('click', function () {
        estado.filtros[boton.getAttribute('data-quitar')] = null;
        estado.pagina = 1;
        cargarDetalle();
      });
    });
  }

  /* fondo = refresco: la misma pagina con los mismos filtros, sin "cargando";
     si falla, se quedan las filas de antes. -> Promise (null). */
  function cargarDetalle(fondo) {
    fondo = fondo === true;
    estado.detalleAbierto = true;
    if (!fondo) {
      pintarFiltros();
      repintarKpis();     // la marca de "Tickets incorrectos" sigue al filtro
      $('detalle-cargando').hidden = false;
      $('detalle-error').hidden = true;
    }

    var token = ++estado.peticionDetalle;

    // Los filtros de la tabla (validacion, grupo, tecnico, grupo correcto) se
    // suman a los de arriba: el detalle es siempre el de la vista.
    return pedir(Object.assign({
      action: 'detail',
      validacion: estado.filtros.validacion,
      grupo: estado.filtros.grupo,
      tecnico: estado.filtros.tecnico,
      grupoCorrecto: estado.filtros.grupoCorrecto,
      page: estado.pagina,
      pageSize: estado.tamano
    }, parametrosVista(estado.vista, estado.defecto))).then(function (datos) {
      if (token !== estado.peticionDetalle) return null;   // respuesta vieja, se ignora
      $('detalle-cargando').hidden = true;
      $('detalle-error').hidden = true;
      pintarDetalle(datos);
      $('detalle-panel').hidden = false;
      return null;
    }).catch(function (err) {
      if (token !== estado.peticionDetalle) return null;
      if (fondo) { console.error('[QA detalle]', err); return null; }
      $('detalle-cargando').hidden = true;
      $('detalle-error-msg').textContent = err.message;
      $('detalle-error').hidden = false;
      return null;
    });
  }

  // Formulario de la incidencia en Proactivanet: la misma URL que celdaCodigo
  // de backlog/backlog.js. qa.ashx manda IdProactivanet (GUID) leido de
  // dbo.TicketProactivanetId; si es null, el codigo queda como texto plano.
  var URL_TICKET_PROACTIVANET =
    'https://soriana.proactivanet.com/proactivanet/servicedesk/incidents/formIncidents/formIncidents.paw?id=';

  function celdaCodigo(t) {
    var codigo = esc(t['Código']);
    if (!t.IdProactivanet) return codigo;
    var href = URL_TICKET_PROACTIVANET + encodeURIComponent(t.IdProactivanet);
    return '<a class="enlace-ticket" href="' + href + '" target="_blank" rel="noopener">' + codigo + '</a>';
  }

  function pintarDetalle(datos) {
    var filas = datos.rows || [];
    estado.total = datos.total || 0;
    estado.pagina = datos.page || 1;

    var desde = estado.total === 0 ? 0 : (estado.pagina - 1) * estado.tamano + 1;
    var hasta = (estado.pagina - 1) * estado.tamano + filas.length;
    var paginas = estado.tamano > 0 ? Math.max(1, Math.ceil(estado.total / estado.tamano)) : 1;

    $('paginacion-txt').textContent =
      estado.total === 0
        ? 'Sin resultados para el filtro actual'
        : NUM.format(desde) + '–' + NUM.format(hasta) + ' de ' + NUM.format(estado.total) +
          ' tickets · pagina ' + estado.pagina + ' de ' + paginas;

    $('btn-prev').disabled = estado.pagina <= 1;
    $('btn-next').disabled = estado.pagina >= paginas;
    $('hint-detalle').textContent = NUM.format(estado.total) + ' tickets filtrados';

    var cuerpo = $('tbody-detalle');
    if (!filas.length) {
      cuerpo.innerHTML = '<tr><td colspan="8" class="vacio">Ningun ticket coincide con el filtro.</td></tr>';
      return;
    }

    // Los nombres de columna son los del workbook original; el prototipo los
    // lee tal cual, sin renombrar nada.
    cuerpo.innerHTML = filas.map(function (t) {
      var correcto = (t['Grupo Correcto'] === null || t['Grupo Correcto'] === undefined || t['Grupo Correcto'] === '')
        ? celdaNula('Sin grupo correcto')
        : esc(t['Grupo Correcto']);
      var validacion = t['Validacion'] || '';
      var clase = validacion === 'Incorrecto' ? 'badge badge-rojo' : 'badge badge-gris';

      return '<tr>' +
        '<td>' + celdaCodigo(t) + '</td>' +
        '<td>' + esc(fechaHora(t['Fecha de registro'])) + '</td>' +
        '<td class="recorte" title="' + esc(t['Título']) + '">' + esc(recortar(t['Título'], 70)) + '</td>' +
        '<td>' + esc(t['Grupo']) + '</td>' +
        '<td>' + esc(t['Técnico de 2ª línea']) + '</td>' +
        '<td class="recorte" title="' + esc(t['Categoría']) + '">' + esc(recortar(t['Categoría'], 60)) + '</td>' +
        '<td>' + correcto + '</td>' +
        '<td><span class="' + clase + '">' + esc(validacion) + '</span></td>' +
        '</tr>';
    }).join('');
  }

  // ------------------------------------------------- filtros de la pestaña
  // Los de QARE (qare/qare.js), con el mismo comportamiento: fechas y rango
  // rapido piden en el acto, los multiselect se juntan en una peticion,
  // "Limpiar" quita solo Servicio / Grupos / Lideres.
  var SELECT_FILTRO = { c1: 'f-c1', grupos: 'f-grupos', lideres: 'f-lideres' };

  function seleccionados(id) {
    return Array.prototype.map.call($(id).selectedOptions, function (o) { return o.value; });
  }

  function filtrosElegidos() {
    var f = {};
    FILTROS_ORG.forEach(function (clave) { f[clave] = seleccionados(SELECT_FILTRO[clave]); });
    return f;
  }

  function leerVista() {
    estado.vista = { inicio: $('f-inicio').value, fin: $('f-fin').value, filtros: filtrosElegidos() };
    return estado.vista;
  }

  function ponerFechas(inicio, fin) {
    $('f-inicio').value = inicio;
    $('f-fin').value = fin;
  }

  function marcarRapido(dias) {
    document.querySelectorAll('#qa-filtros [data-dias]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.dias) === dias));
    });
  }

  function ponerRango(dias) {
    var r = rangoRapido(dias, Date.now());
    ponerFechas(r.inicio, r.fin);
    marcarRapido(dias);
  }

  /* Una vista nueva: se repinta todo lo que sigue a los filtros -KPIs,
     distribucion, recategorizacion y, si esta abierto, el detalle desde la
     pagina 1-. Las dos graficas no (pintarBase). */
  function aplicarVista() {
    leerVista();
    actualizarDescarga();
    cargarResumen();
    if (estado.detalleAbierto) {
      estado.pagina = 1;
      cargarDetalle();
    }
  }

  /* Refresco automatico (dashboard.js) y boton "Actualizar": la vista que se
     esta viendo, y el detalle si esta abierto, en su misma pagina. Nunca
     encima de un resumen en vuelo o de una carga programada por un filtro
     (esa ya trae lo ultimo), ni antes de la primera carga buena. El
     automatico y el boton comparten UN refresco en vuelo. */
  var refrescoEnCurso = null;
  function refrescoFondo() {
    if (!refrescoEnCurso) {
      var detalle = estado.detalleAbierto ? cargarDetalle(true) : null;
      refrescoEnCurso = Promise.all([cargarResumen(true), detalle])
        .then(function (r) { return r[0]; }, function () { return null; })
        .then(function (r) { refrescoEnCurso = null; return r; });
    }
    return refrescoEnCurso;
  }
  function refrescar() {
    if (resumenEnVuelo > 0 || cargaProgramada !== null || !cargadoUnaVez) return Promise.resolve(null);
    return refrescoFondo();
  }
  // Boton "Actualizar": igual; sin carga buena todavia, una normal.
  function actualizarAhora() {
    if (resumenEnVuelo > 0) return Promise.resolve(null);
    return cargadoUnaVez ? refrescoFondo() : cargarResumen();
  }

  var ESPERA_AUTO = 250;
  var cargaProgramada = null;
  function programarCarga() {
    clearTimeout(cargaProgramada);
    cargaProgramada = setTimeout(function () { cargaProgramada = null; aplicarVista(); }, ESPERA_AUTO);
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

  /* Las listas, una vez al arrancar y sin frenar la primera carga: si
     fallan, QA sigue funcionando sin filtros y el error va a la consola. */
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
      .catch(function (err) { console.error('[QA catalogos]', err); });
  }

  // ------------------------------------------------------------ descarga
  /* Como "⬇ Descargar QARE": el boton solo se ve con algun filtro de
     Servicio / Grupo / Lider puesto. */
  function actualizarDescarga() {
    $('btn-descargar').style.display = hayFiltroOrg(filtrosElegidos()) ? '' : 'none';
  }

  // SheetJS se trae la primera vez que se pulsa; si QARE o Experiencia ya lo
  // cargaron, se reusa.
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

  /* Los tickets del rango y de los filtros de arriba, TODOS los estados de
     validacion: la misma intencion que QARE (el rango y los filtros que se
     estan viendo, no la pagina ni las etiquetas del detalle). Sale de
     qa.ashx?action=detail&pageSize=0, el detalle de siempre sin paginar. */
  var descargando = false;
  function descargar() {
    if (descargando) return;
    var vista = leerVista();
    if (!vista.inicio || !vista.fin || vista.inicio > vista.fin) {
      alert('Rango de fechas invalido: la fecha inicio debe ser anterior o igual a la fecha fin.');
      return;
    }
    var btn = $('btn-descargar'), rotulo = btn.textContent;
    descargando = true;
    btn.disabled = true;
    btn.textContent = 'Preparando…';
    // Rango explicito siempre: es el que va en el nombre del archivo.
    var params = parametrosVista(vista, null);
    pedir(Object.assign({ action: 'detail', page: 1, pageSize: 0 }, params))
      .then(function (d) {
        var tickets = d.rows || [];
        if (!tickets.length) { alert('No hay tickets QA para el rango y los filtros actuales.'); return; }
        var s = (d.meta && d.meta.source) || {};
        var fi = s.fechaInicio || vista.inicio, ff = s.fechaFin || vista.fin;
        return cargarXLSX().then(function (XLSX) {
          var meta = metaExport(fi, ff, vista.filtros, tickets.length, new Date().toLocaleString('es-MX'));
          bajar(libroExport(XLSX, tickets, meta), nombreExport(fi, ff, vista.filtros));
        });
      })
      .catch(function (err) {
        console.error('[QA descarga]', err);
        alert('No se pudo descargar QA: ' + err.message);
      })
      .then(function () {
        descargando = false;
        btn.disabled = false;
        btn.textContent = rotulo;
      });
  }

  // ------------------------------------------------------------- arranque
  function conectarFiltros() {
    document.querySelectorAll('#qa-filtros [data-dias]').forEach(function (b) {
      b.addEventListener('click', function () { ponerRango(Number(b.dataset.dias)); aplicarVista(); });
    });
    ['f-inicio', 'f-fin'].forEach(function (id) {
      $(id).addEventListener('change', function () { marcarRapido(null); aplicarVista(); });
    });
    FILTROS_ORG.forEach(function (clave) {
      $(SELECT_FILTRO[clave]).addEventListener('change', programarCarga);
      $(SELECT_FILTRO[clave]).addEventListener('change', actualizarDescarga);
    });
    $('btn-limpiar').addEventListener('click', limpiarFiltros);
    $('btn-descargar').addEventListener('click', descargar);
  }

  function conectarEventos() {
    $('btn-reintentar').addEventListener('click', function () { cargarResumen(); });
    if (window.RefrescoAuto) RefrescoAuto.cablearBoton($('btn-actualizar'), actualizarAhora);
    conectarFiltros();

    $('btn-detalle').addEventListener('click', function () {
      estado.filtros = filtrosPorDefecto();
      estado.pagina = 1;
      cargarDetalle();
    });

    // "Tickets incorrectos" (ver KPI_INCORRECTOS).
    if (SK) SK.escuchar([$('kpis')], 'data-indicador', function (k) {
      if (!estado.kpis) return;
      marcarDesdeDetalle();
      seleccion.alternar(k);
      estado.filtros.validacion = seleccion.clave ? 'Incorrecto' : null;
      estado.pagina = 1;
      cargarDetalle();
      SK.enfocar([$('kpis')], 'data-indicador', k);
      var card = $('btn-detalle').closest ? $('btn-detalle').closest('.card') : null;
      if (seleccion.clave && card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });

    $('sel-tam').addEventListener('change', function () {
      estado.tamano = Number(this.value) || 100;
      estado.pagina = 1;
      if (estado.detalleAbierto) cargarDetalle();
    });

    $('btn-prev').addEventListener('click', function () {
      if (estado.pagina > 1) { estado.pagina--; cargarDetalle(); }
    });
    $('btn-next').addEventListener('click', function () {
      estado.pagina++; cargarDetalle();
    });
  }

  // El orden importa: la pagina se arma ENTERA y se conecta antes de pedir
  // nada. Lo que llega despues rellena estos componentes, no los crea, asi
  // que ninguna peticion -- ni su fallo -- decide si el tablero se ve.
  function arrancar() {
    if (arrancado) return;              // el modulo se monta una sola vez
    if (!$('kpis')) return;             // sin marcado no hay nada que armar
    arrancado = true;
    // La vista con la que abre: los 15 dias por omision, sin filtros.
    ponerRango(DIAS_POR_OMISION);
    estado.defecto = { inicio: $('f-inicio').value, fin: $('f-fin').value };
    leerVista();
    armarShell();
    conectarEventos();
    /* Capa visual del desplegable de "Filas por pagina". Es el MISMO
       componente que el resto del tablero (assets/js/desplegable.js), no una
       copia: el <select id="qa-sel-tam"> se queda con su id, sus opciones y el
       listener de conectarEventos(), que sigue recibiendo su `change`. Va
       despues de conectarEventos para que ese listener este puesto antes. */
    if (window.Desplegable) {
      Desplegable.montar(document.getElementById('tab-qa') || document);
    }
    cargarCatalogos();
    cargarResumen();
  }

  var arrancado = false;

  /* Dos formas de llegar aqui:
       - pagina suelta: el <script> esta en el HTML y el documento puede seguir
         cargando, asi que se espera a DOMContentLoaded;
       - pestaña del tablero: dashboard.js inyecta el script cuando el marcado
         ya esta puesto y DOMContentLoaded paso hace rato. Entonces se arranca
         en el acto. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', arrancar);
  } else {
    arrancar();
  }

  /* Lo unico que el modulo publica hacia fuera. Lo usa TableroQa (dashboard.js)
     al volver a la pestaña: las graficas siguen montadas y solo hay que
     remedirlas, porque mientras la pestaña estuvo oculta su contenedor midio
     cero; y el refresco automatico (refrescar). La logica de QA no sale de
     este archivo. */
  window.TableroQaModulo = {
    redimensionar: function () {
      Object.keys(graficas).forEach(function (k) {
        if (graficas[k]) graficas[k].resize();
      });
    },
    recargar: function () { return cargarResumen(); },
    refrescar: refrescar
  };
})(typeof window !== 'undefined' ? window : this);
