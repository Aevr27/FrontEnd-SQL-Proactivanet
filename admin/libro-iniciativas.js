/* =========================================================================
   admin/libro-iniciativas.js

   El .xlsx del boton "⬇ Descargar iniciativas" del registro de
   admin/iniciativas.html. Solo arma el ARCHIVO: que filas y columnas lleva
   lo decide admin/registro-iniciativas.js (ExportRegistro), que es quien
   conoce el registro, sus filtros y su orden.

   Entrada: una lista de hojas { nombre, columnas: [{ t, tipo, ancho }],
   filas: [[valor, ...]] }. tipo:
     texto   tal cual (codigos y nombres nunca se reinterpretan)
     entero  numero con separador de miles
     pct     fraccion (0.25) con formato 0.0 %
     fecha   'aaaa-mm-dd' -> fecha real de Excel (dd/mm/aaaa); otra cosa,
             vacia
   null / undefined / '' = celda vacia.

   METODO: el de QARE y "Descargar Tickets" de Experiencia. El vendor
   (experiencia/vendor/xlsx.mini.min.js, SheetJS comunitario 0.18.5) escribe
   anchos y autofiltro pero IGNORA el `s` de las celdas y no congela
   paneles; asi que el libro se arma con SheetJS y despues se retocan, con
   el mismo vendor (XLSX.CFB), xl/styles.xml (estilos propios) y cada
   xl/worksheets/sheetN.xml (encabezado congelado y s="i" por celda). Ni un
   valor cambia: el `s` es solo formato.

   Sin DOM ni red: `XLSX` entra por parametro para que
   tools/tests/ExportIniciativasSmoke.js le pase el mismo vendor.
   ========================================================================= */
window.LibroIniciativas = (function () {
  'use strict';

  // Tope de Excel por celda (32.767). Mismo recorte que QARE/Experiencia:
  // lo que no cabe termina con un aviso y no parte un par sustituto.
  var LIMITE_CELDA = 32767;
  function ajustarCelda(valor) {
    if (typeof valor !== 'string' || valor.length <= LIMITE_CELDA) return valor;
    var aviso = ' … [recortado: ' + valor.length + ' caracteres en origen]';
    var corte = LIMITE_CELDA - aviso.length;
    var c = valor.charCodeAt(corte - 1);
    if (c >= 0xD800 && c <= 0xDBFF) corte--;
    return valor.slice(0, corte) + aviso;
  }

  // 'aaaa-mm-dd' -> numero de serie de Excel (dias desde 1899-12-30), o null.
  function serieFecha(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof s === 'string' ? s : '');
    if (!m) return null;
    var t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    var d = new Date(t);
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return null;
    return Math.round((t - Date.UTC(1899, 11, 30)) / 86400000);
  }

  function valorCelda(v, tipo) {
    if (v === null || v === undefined || v === '') return null;
    if (tipo === 'fecha') return serieFecha(v);
    if (tipo === 'entero' || tipo === 'pct') return typeof v === 'number' && isFinite(v) ? v : null;
    return ajustarCelda(String(v));
  }

  // ---- estilos ----
  var VERDE = 'FF166534', ZEBRA = 'FFF3F6F4', LINEA = 'FFE2E6E4', TINTA = 'FF111827';
  // Indices de cellXfs (mismo orden que XFS). Cada tipo tiene su par
  // normal / zebra: estilo = TIPO[tipo] + (zebra ? 1 : 0).
  var ENCABEZADO = 1;
  var TIPO = { texto: 2, entero: 4, pct: 6, fecha: 8 };
  var FMT_PCT = 164, FMT_FECHA = 165;

  function hojaEstilos() {
    function fuente(attrs) { return '<font>' + attrs + '<name val="Calibri"/><family val="2"/><scheme val="minor"/></font>'; }
    function relleno(color) { return '<fill><patternFill patternType="solid"><fgColor rgb="' + color + '"/><bgColor indexed="64"/></patternFill></fill>'; }
    var fuentes = [
      fuente('<sz val="11"/><color rgb="' + TINTA + '"/>'),
      fuente('<b/><sz val="11"/><color rgb="FFFFFFFF"/>')
    ];
    var rellenos = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>',
      relleno(VERDE), relleno(ZEBRA)];
    var lado = ['left', 'right', 'top', 'bottom'].map(function (l) {
      return '<' + l + ' style="thin"><color rgb="' + LINEA + '"/></' + l + '>';
    }).join('') + '<diagonal/>';
    var bordes = ['<border><left/><right/><top/><bottom/><diagonal/></border>', '<border>' + lado + '</border>'];
    var arriba = '<alignment vertical="top"/>';
    // [numFmt, fuente, relleno, borde, alineacion]
    var xfs = [
      [0, 0, 0, 0, ''],
      [0, 1, 2, 1, '<alignment vertical="center" wrapText="1"/>'],
      [0, 0, 0, 1, arriba], [0, 0, 3, 1, arriba],
      [3, 0, 0, 1, arriba], [3, 0, 3, 1, arriba],
      [FMT_PCT, 0, 0, 1, arriba], [FMT_PCT, 0, 3, 1, arriba],
      [FMT_FECHA, 0, 0, 1, arriba], [FMT_FECHA, 0, 3, 1, arriba]
    ];
    var xf = xfs.map(function (x) {
      return '<xf numFmtId="' + x[0] + '" fontId="' + x[1] + '" fillId="' + x[2] + '" borderId="' + x[3] + '" xfId="0"' +
        (x[0] ? ' applyNumberFormat="1"' : '') + ' applyFont="1" applyFill="1" applyBorder="1"' +
        (x[4] ? ' applyAlignment="1">' + x[4] + '</xf>' : '/>');
    }).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<numFmts count="2"><numFmt numFmtId="' + FMT_PCT + '" formatCode="0.0%"/>' +
      '<numFmt numFmtId="' + FMT_FECHA + '" formatCode="dd/mm/yyyy"/></numFmts>' +
      '<fonts count="' + fuentes.length + '">' + fuentes.join('') + '</fonts>' +
      '<fills count="' + rellenos.length + '">' + rellenos.join('') + '</fills>' +
      '<borders count="' + bordes.length + '">' + bordes.join('') + '</borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="' + xfs.length + '">' + xf + '</cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleMedium4"/>' +
      '</styleSheet>';
  }

  function estiloDe(fila, col, columnas) {
    if (fila === 0) return ENCABEZADO;
    var c = columnas[col];
    if (!c) return 0;
    return (TIPO[c.tipo] || TIPO.texto) + (fila % 2 === 0 ? 1 : 0);
  }

  function aBytes(texto) {
    // El XML que escribe el vendor y el de los estilos viajan como UTF-8
    // byte a byte (aTexto los leyo asi): no se recodifica nada.
    var b = new Uint8Array(texto.length);
    for (var i = 0; i < texto.length; i++) b[i] = texto.charCodeAt(i) & 255;
    return b;
  }
  function aTexto(contenido) {
    var s = '';
    for (var i = 0; i < contenido.length; i++) s += String.fromCharCode(contenido[i]);
    return s;
  }

  // Encabezado (fila 1) congelado y s="i" en cada celda.
  function retocarHoja(xml, columnas) {
    var pane = '<sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView>';
    var salida = xml.replace('<sheetView workbookViewId="0"/>', pane);
    return salida.replace(/<c r="([A-Z]+)(\d+)"/g, function (todo, letras, numero) {
      var col = 0;
      for (var i = 0; i < letras.length; i++) col = col * 26 + (letras.charCodeAt(i) - 64);
      var estilo = estiloDe(parseInt(numero, 10) - 1, col - 1, columnas);
      return estilo ? todo + ' s="' + estilo + '"' : todo;
    });
  }

  function hojaSheetJS(XLSX, h) {
    var aoa = [h.columnas.map(function (c) { return c.t; })];
    h.filas.forEach(function (f) {
      aoa.push(h.columnas.map(function (c, n) { return valorCelda(f[n], c.tipo); }));
    });
    var hoja = XLSX.utils.aoa_to_sheet(aoa);
    hoja['!cols'] = h.columnas.map(function (c) { return { wch: Math.max(c.ancho || 12, c.t.length + 3) }; });
    hoja['!rows'] = [{ hpt: 30 }];
    var ultima = h.columnas.length - 1;
    hoja['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(aoa.length - 1, 1), c: ultima } }) };
    // Con cero filas el rango de la hoja seria solo el encabezado; se deja
    // tal cual (el autofiltro abarca una fila vacia, como Excel al filtrar
    // una tabla sin datos).
    return hoja;
  }

  // hojas -> bytes del .xlsx (Uint8Array / array).
  function construir(XLSX, hojas) {
    var libro = XLSX.utils.book_new();
    hojas.forEach(function (h) { XLSX.utils.book_append_sheet(libro, hojaSheetJS(XLSX, h), h.nombre); });
    var zip = XLSX.CFB.read(XLSX.write(libro, { type: 'binary', bookType: 'xlsx' }), { type: 'binary' });
    XLSX.CFB.utils.cfb_add(zip, '/xl/styles.xml', aBytes(hojaEstilos()));
    hojas.forEach(function (h, n) {
      var ruta = '/xl/worksheets/sheet' + (n + 1) + '.xml';
      var parte = XLSX.CFB.find(zip, ruta);
      XLSX.CFB.utils.cfb_add(zip, ruta, aBytes(retocarHoja(aTexto(parte.content), h.columnas)));
    });
    return XLSX.CFB.write(zip, { fileType: 'zip', type: 'array', compression: true });
  }

  return {
    construir: construir,
    serieFecha: serieFecha,
    ajustarCelda: ajustarCelda,
    LIMITE_CELDA: LIMITE_CELDA
  };
})();
