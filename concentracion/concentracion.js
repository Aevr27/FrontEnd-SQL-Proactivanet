/* =========================================================================
   concentracion/concentracion.js

   Pestaña "Vista general de servicios" (antes "Concentracion de tickets";
   carpeta, handler y hash conservan el nombre original). Un solo archivo para
   la pagina suelta (concentracion/concentracion.html) y para la pestaña del
   tablero, que monta ese mismo marcado e inyecta este mismo script
   (TableroConcentracion en dashboard.js).

   Es INDEPENDIENTE de "Analisis de servicios": carga sola al abrirse, sin
   elegir servicio, y no lee ni escribe nada de esa pestaña.

   Filtros (estado `filtros`): Periodo por Slot O por Mes -nunca los dos-,
   Service Owner y Grupo. Cada cambio es UNA peticion a
   handlers/concentracion.ashx con todos los filtros; el servidor filtra y
   cuenta (App_Code/ConcentracionContrato.cs) y entrega TODAS las filas de
   cada grafica con el acumulado ya calculado sobre el total filtrado. Aqui
   solo se recorta al Top 10 / 15 para pintar.

   Regla de datos: lo que el API no trae no se calcula aqui. Porcentajes,
   acumulado y TotalTickets son los del servidor (escala 0-100). Lo unico que
   se deriva es de presentacion: que barras caen antes del 80 % (con el
   acumulado de la fila ANTERIOR, que tambien viene del servidor) y la
   etiqueta abreviada de una categoria. El periodo (Slot o Mes) tambien lo
   manda el servidor; no se calcula con el reloj del navegador.

   Refrescos ("Actualizar" y el automatico) piden con los MISMOS filtros y
   repintan las listas de Service Owner / Grupo sin perder lo elegido.

   Dos partes:
     1. ConcentracionDatos: funciones PURAS (sin DOM), publicadas en
        window.ConcentracionDatos para tools/tests/ConcentracionVistaSmoke.js.
     2. El tablero: shell, peticion y pintado. Solo corre si hay documento y
        el marcado de la pestaña esta puesto.
   ========================================================================= */

(function (raiz) {
  'use strict';

  // ================================================================ 1. puro

  var NUM = new Intl.NumberFormat('es-MX');
  var NUM1 = new Intl.NumberFormat('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  // Cuantas barras pinta cada grafica (el resto cuenta en el acumulado).
  var TOP = { pareto: 10, categorias: 15, grupos: 15 };
  var UMBRAL = 80;
  var SLOT_MAXIMO = 12;          // el servidor lo confirma en d.slotMaximo
  var LARGO_ETIQUETA = 44;       // caracteres de la etiqueta abreviada
  var ANCHO_LINEA_EJE = 26;      // caracteres por linea en el eje de las horizontales

  var NOMBRES = { pareto: 'servicios', categorias: 'categorías', grupos: 'grupos' };

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

  function texto(v) {
    if (v === null || v === undefined) return '(sin valor)';
    var t = String(v).trim();
    return t === '' ? '(vacío)' : t;
  }

  /* Nombre completo de la barra. El Pareto llega en dos versiones (ver
     ConcentracionContrato): con NombreServicio (82_pareto_por_servicio.sql)
     se usa ese; sin el, Servicio, que hoy es el nombre de la rama. */
  function etiquetaFila(clave, fila) {
    fila = fila || {};
    if (clave === 'pareto') {
      var nombre = fila.NombreServicio;
      return texto(nombre !== null && nombre !== undefined && String(nombre).trim() !== '' ? nombre : fila.Servicio);
    }
    return texto(clave === 'categorias' ? fila.Categoria : fila.Grupo);
  }

  function recortar(t, max) {
    t = String(t);
    return t.length > max ? t.slice(0, max - 1).replace(/\s+$/, '') + '…' : t;
  }

  /* Ruta de categoria para el eje: los dos ultimos niveles
     ("/S-Biométrico/Falla en sistema de biométrico/Usuario no encontrado" ->
     "Falla en sistema de biométrico › Usuario no encontrado"), recortada a
     `max`. La ruta completa va en el tooltip. Una ruta de uno o dos niveles
     se queda entera. */
  function abreviarRuta(ruta, max) {
    var niveles = String(ruta === null || ruta === undefined ? '' : ruta)
      .split('/').map(function (n) { return n.trim(); }).filter(Boolean);
    var corta = niveles.length ? niveles.slice(-2).join(' › ') : texto(ruta);
    return recortar(corta, max || LARGO_ETIQUETA);
  }

  /* Por fila de la lista COMPLETA: true si la fila entra antes de alcanzar
     el 80 %, o sea si el acumulado de la fila ANTERIOR es < 80 (la primera,
     contra 0). La que cruza el 80 % cuenta dentro: es la que lo alcanza.
     Sin acumulado, false (no se adivina). */
  function marcarDentro(filas) {
    var previo = 0;
    return (filas || []).map(function (f) {
      var acum = numero(f && f.PorcentajeAcumulado);
      if (acum === null) return false;
      var dentro = previo < UMBRAL;
      previo = acum;
      return dentro;
    });
  }

  /* Lo que pinta una grafica: el Top N de la lista completa, con su marca
     del 80 % (calculada sobre la lista completa) y el total del propio SP.
     null = la grafica fallo; [] = sin tickets en el Slot. */
  function vista(clave, filas) {
    if (filas === null || filas === undefined) return null;
    var dentro = marcarDentro(filas);
    var n = TOP[clave] || filas.length;
    var top = filas.slice(0, n);
    var etiquetas = top.map(function (f) { return etiquetaFila(clave, f); });
    return {
      filas: top,
      cuantas: filas.length,
      total: filas.length ? numero(filas[0].TotalTickets) : null,
      dentro: dentro.slice(0, n),
      etiquetas: etiquetas,
      cortas: etiquetas.map(function (e) {
        return clave === 'categorias' ? abreviarRuta(e) : recortar(e, LARGO_ETIQUETA);
      }),
      cantidades: top.map(function (f) { return numero(f.CantidadTickets); }),
      acumulado: top.map(function (f) { return numero(f.PorcentajeAcumulado); }),
    };
  }

  // "Top 10 de 33 servicios · 11,492 tickets"
  function resumen(clave, v) {
    if (!v || !v.cuantas) return '';
    var top = v.filas.length < v.cuantas ? 'Top ' + v.filas.length + ' de ' : '';
    return top + NUM.format(v.cuantas) + ' ' + NOMBRES[clave] + ' · ' + entero(v.total) + ' tickets';
  }

  // "aaaa-mm-dd" -> "dd/mm/aaaa" sin pasar por Date (no cambia de zona).
  function diaTexto(iso) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '';
  }

  // { desde, hasta } del servidor -> "Del 11/10/2026 al 09/11/2026".
  function textoPeriodo(periodo) {
    if (!periodo || !periodo.desde || !periodo.hasta) return '';
    return 'Del ' + diaTexto(periodo.desde) + ' al ' + diaTexto(periodo.hasta);
  }

  /* Aviso de cobertura parcial: solo si el servidor la midio y dice que NO
     esta completa (ConcentracionContrato, COBERTURA). Dice el hecho -en
     cuantos dias del Slot hay tickets- y el rango de dias con datos; no
     estima nada. null / completa = sin aviso. */
  function textoCobertura(c) {
    if (!c || c.completa !== false) return '';
    var dias = numero(c.diasConTickets), esperados = numero(c.diasEsperados);
    if (dias === null || esperados === null) return '';
    var base = 'Cobertura parcial: hay tickets en ' + dias + ' de ' + esperados +
               (c.excluyeHoy ? ' días completos (sin contar hoy)' : ' días del periodo');
    if (!dias) return base + '.';
    var rango = c.primerDia && c.ultimoDia
      ? ' · datos del ' + diaTexto(c.primerDia) + ' al ' + diaTexto(c.ultimoDia) : '';
    return base + rango + '.';
  }

  /* Lo que se escribio en el campo -> Slot entero 0..max, o null si no es un
     numero (el campo vuelve al Slot vigente). Fuera de rango se acota, como
     el stepper de SLA. */
  function acotarSlot(valor, max) {
    var t = String(valor === null || valor === undefined ? '' : valor).trim();
    if (!/^\d+$/.test(t)) return null;
    var n = parseInt(t, 10);
    max = max === undefined ? SLOT_MAXIMO : max;
    return Math.max(0, Math.min(max, n));
  }

  /* Etiqueta del eje de una barra horizontal en a lo mas `maxLineas` lineas
     de `ancho` caracteres, por palabras. Chart.js limita el ancho del eje y
     recorta por la izquierda lo que no cabe; en dos lineas cortas se lee
     entera. Si aun asi no cabe, la ultima linea termina en "…" (el tooltip
     lleva el nombre completo). */
  function lineasEje(t, ancho, maxLineas) {
    ancho = ancho || ANCHO_LINEA_EJE;
    maxLineas = maxLineas || 2;
    var palabras = String(t).split(/\s+/).filter(Boolean);
    var lineas = [], actual = '';
    palabras.forEach(function (p) {
      while (p.length > ancho) {            // palabra mas larga que la linea
        if (actual) { lineas.push(actual); actual = ''; }
        lineas.push(p.slice(0, ancho)); p = p.slice(ancho);
      }
      if (actual && (actual + ' ' + p).length > ancho) { lineas.push(actual); actual = p; }
      else actual = actual ? actual + ' ' + p : p;
    });
    if (actual) lineas.push(actual);
    if (lineas.length > maxLineas) {
      lineas = lineas.slice(0, maxLineas);
      var ultima = lineas[maxLineas - 1].replace(/…$/, '');
      lineas[maxLineas - 1] = (ultima.length >= ancho ? ultima.slice(0, ancho - 1) : ultima).replace(/\s+$/, '') + '…';
    }
    return lineas.length > 1 ? lineas : (lineas[0] || String(t));
  }

  /* Filtros -> query string de concentracion.ashx. Solo viaja el parametro
     del modo elegido (slot o mes); las listas van separadas por "|" porque
     un nombre de persona puede llevar coma. */
  function consulta(f) {
    var p = ['modo=' + (f.modo === 'mes' ? 'mes' : 'slot')];
    if (f.modo === 'mes') { if (f.mes) p.push('mes=' + encodeURIComponent(f.mes)); }
    else p.push('slot=' + encodeURIComponent(f.slot || 0));
    if (f.so && f.so.length) p.push('so=' + encodeURIComponent(f.so.join('|')));
    if (f.grupo && f.grupo.length) p.push('grupo=' + encodeURIComponent(f.grupo.join('|')));
    return p.join('&');
  }

  function lista(valores, vacio) {
    if (!valores || !valores.length) return vacio;
    return valores.length <= 3 ? valores.join(', ') : valores.slice(0, 3).join(', ') + ' y ' + (valores.length - 3) + ' más';
  }

  /* Lo aplicado, como lo confirmo el SERVIDOR (no lo que hay en los
     controles mientras se escribe): periodo con sus fechas, filtros y
     cuantos tickets quedan de los del periodo. */
  function textoActivos(d) {
    if (!d) return '';
    var etiquetaMes = '';
    (d.meses || []).forEach(function (m) { if (m.valor === d.mes) etiquetaMes = m.etiqueta + (m.enCurso ? ' (en curso, hasta hoy)' : ''); });
    var periodo = d.modo === 'mes' ? 'Mes ' + (etiquetaMes || d.mes) : 'Slot ' + d.slot;
    var fechas = textoPeriodo(d.periodo);
    var f = d.filtros || {};
    var partes = ['Periodo: ' + periodo + (fechas ? ' · ' + fechas.charAt(0).toLowerCase() + fechas.slice(1) : ''),
                  'Service Owner: ' + lista(f.serviceOwners, 'todos'),
                  'Grupo: ' + lista(f.grupos, 'todos')];
    var filtrando = (f.serviceOwners && f.serviceOwners.length) || (f.grupos && f.grupos.length);
    partes.push(filtrando
      ? entero(d.ticketsFiltrados) + ' de ' + entero(d.ticketsPeriodo) + ' tickets del periodo'
      : entero(d.ticketsPeriodo) + ' tickets en el periodo');
    return partes.join(' · ');
  }

  // Mensaje de una grafica sin barras: periodo vacio o filtros sin tickets.
  function mensajeVacio(d) {
    return d && numero(d.ticketsPeriodo) > 0 ? 'Sin tickets con estos filtros.' : 'Sin tickets en este periodo.';
  }

  var ConcentracionDatos = {
    consulta: consulta, textoActivos: textoActivos, mensajeVacio: mensajeVacio,
    TOP: TOP, UMBRAL: UMBRAL, SLOT_MAXIMO: SLOT_MAXIMO, LARGO_ETIQUETA: LARGO_ETIQUETA,
    numero: numero, etiquetaFila: etiquetaFila, abreviarRuta: abreviarRuta, recortar: recortar,
    marcarDentro: marcarDentro, vista: vista, resumen: resumen, textoPeriodo: textoPeriodo,
    acotarSlot: acotarSlot, lineasEje: lineasEje, textoCobertura: textoCobertura,
  };
  raiz.ConcentracionDatos = ConcentracionDatos;

  // ============================================================ 2. tablero
  if (typeof document === 'undefined') return;

  function ruta(handler) {
    var yo = document.currentScript && document.currentScript.src;
    try { return new URL('../handlers/' + handler, yo).href; }
    catch (e) { return 'handlers/' + handler; }
  }
  var API = ruta('concentracion.ashx');

  var PREFIJO = 'conc-';
  function $(id) { return document.getElementById(PREFIJO + id); }
  function esc(v) { return Escape.html(v); }

  var ALTO_FILA = 38;           // dos lineas de 11.5px por barra
  var ANCHO_ESTRECHO = 640;     // px del Pareto por debajo de los cuales se compacta

  /* Colores (2026-11-09, retroalimentacion: el verde se sentia fuerte).
     Azules suaves para el volumen: azul acero dentro del 80 % y su version
     clara para el resto, que se distinguen sin saturar. El acumulado va en
     ambar apagado -calido, para no confundirse con ninguna barra- y la
     referencia del 80 % en gris pizarra punteado. Mismos valores que la
     leyenda de concentracion.css. */
  var COLOR = { dentro: '#5b84b1', fuera: '#c3d5ea', acumulado: '#d39a3a', referencia: '#8a94a6' };
  var TINTA = { eje: '#5e5e5f', etiqueta: '#393939', rejilla: '#eef1f6' };

  var graficas = {};
  // Lo que el usuario eligio; viaja completo en cada peticion y en cada refresco.
  var filtros = { modo: 'slot', slot: 0, mes: null, so: [], grupo: [] };
  var slotMaximo = SLOT_MAXIMO;
  var ultima = null;            // ultima respuesta buena (para el texto de vacio)
  var peticion = 0;

  // ---------------------------------------------------------- mensajes
  function mensaje(clave, txt, esError) {
    var caja = $('msg-' + clave);
    if (!caja) return;
    caja.hidden = !txt;
    caja.textContent = txt || '';
    caja.classList.toggle('conc-msg-error', !!esError);
  }

  function destruir(clave) {
    if (graficas[clave]) { graficas[clave].destroy(); graficas[clave] = null; }
  }

  /* null = fallo (el mensaje viene en errores), [] = sin datos. Devuelve la
     vista, o null si ya se atendio y no hay nada que graficar. */
  function preparar(clave, filas, errores) {
    $('hint-' + clave).textContent = '';
    var v = vista(clave, filas);
    if (!v) {
      destruir(clave);
      mensaje(clave, (errores && errores[clave]) || 'Sin datos: la gráfica no llegó.', true);
      return null;
    }
    if (!v.filas.length) {
      destruir(clave);
      mensaje(clave, mensajeVacio(ultima));
      return null;
    }
    mensaje(clave, null);
    $('hint-' + clave).textContent = resumen(clave, v) + (clave === 'pareto' ? ' · referencia 80 %' : '');
    return v;
  }

  function colores(v) {
    return v.dentro.map(function (d) { return d ? COLOR.dentro : COLOR.fuera; });
  }

  // ---------------------------------------------------------- graficas
  /* La cifra del acumulado encima de cada punto de la linea (como el
     Pareto de QARE): en un Pareto se busca "donde cruza el 80 %". */
  var CIFRAS_ACUMULADO = {
    id: 'concCifrasAcumulado',
    afterDatasetsDraw: function (chart) {
      var meta = chart.getDatasetMeta(1);
      // Angosta (telefono), las cifras se enciman: quedan en el tooltip.
      if (!meta || meta.hidden || chart.width < ANCHO_ESTRECHO) return;
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

  // Etiqueta del eje X del Pareto partida en lineas cortas, sin recorte.
  function partir(t, ancho) {
    var palabras = String(t).split(/\s+/).filter(Boolean);
    var lineas = [], actual = '';
    palabras.forEach(function (p) {
      if (actual && (actual + ' ' + p).length > ancho) { lineas.push(actual); actual = p; }
      else actual = actual ? actual + ' ' + p : p;
    });
    if (actual) lineas.push(actual);
    return lineas.length > 1 ? lineas : (lineas[0] || String(t));
  }

  /* Pareto: barras = CantidadTickets (eje izquierdo), linea amarilla =
     PorcentajeAcumulado (eje derecho 0-100 %), punteada = 80 %. */
  function pintarPareto(filas, errores) {
    var v = preparar('pareto', filas, errores);
    if (!v) return;
    destruir('pareto');
    /* Angosta: diez nombres completos no caben debajo de sus barras; van
       cortos y girados, completos en el tooltip. Se decide al pintar (un
       cambio de ancho se ve al siguiente Slot o refresco). */
    var estrecho = $('chart-pareto').parentNode.clientWidth < ANCHO_ESTRECHO;
    graficas.pareto = new DashboardBarChart({
      canvas: $('chart-pareto'),
      etiquetas: v.etiquetas.map(function (t) { return estrecho ? recortar(t, 12) : partir(t, 14); }),
      formato: function (n) { return NUM.format(n); },
      barra: { maxBarThickness: 64 },
      datasets: [
        { type: 'bar', label: 'Tickets', yAxisID: 'y', order: 3, backgroundColor: colores(v),
          data: v.cantidades },
        { type: 'line', label: '% acumulado', yAxisID: 'y2', order: 1, data: v.acumulado,
          borderColor: COLOR.acumulado, backgroundColor: COLOR.acumulado,
          borderWidth: 2.5, pointRadius: 4, pointHoverRadius: 6, tension: 0 },
        { type: 'line', label: 'Referencia 80 %', yAxisID: 'y2', order: 2,
          data: v.etiquetas.map(function () { return UMBRAL; }),
          borderColor: COLOR.referencia, borderWidth: 1, borderDash: [5, 5],
          pointRadius: 0, pointHoverRadius: 0, fill: false },
      ],
      plugins: [CIFRAS_ACUMULADO],
      opciones: {
        maintainAspectRatio: false,
        layout: { padding: { top: 26, right: 8, left: 8 } },
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter: function (item) { return item.datasetIndex !== 2; },
            callbacks: {
              title: function (items) { return items.length ? v.etiquetas[items[0].dataIndex] : ''; },
              label: function (item) {
                var f = v.filas[item.dataIndex];
                return item.datasetIndex === 0
                  ? entero(f.CantidadTickets) + ' tickets · ' + pct(f.Porcentaje)
                  : 'Acumulado: ' + pct(f.PorcentajeAcumulado);
              },
              afterBody: function (items) {
                if (!items.length) return '';
                var f = v.filas[items[0].dataIndex];
                // Con la version por codigo (82), el codigo del servicio.
                return f.NombreServicio && f.Servicio && f.NombreServicio !== f.Servicio
                  ? 'Servicio: ' + f.Servicio : '';
              },
            },
          },
        },
        scales: {
          x: { ticks: { color: TINTA.etiqueta, autoSkip: false, font: { size: estrecho ? 10.5 : 11.5 },
                        maxRotation: estrecho ? 60 : 0, minRotation: estrecho ? 60 : 0 },
               grid: { display: false } },
          y: { beginAtZero: true, grace: '8%', ticks: { precision: 0, color: TINTA.eje, font: { size: 12 } },
               grid: { color: TINTA.rejilla },
               title: { display: true, text: 'Tickets', color: TINTA.eje, font: { size: 12 } } },
          y2: { position: 'right', min: 0, max: 100, grid: { drawOnChartArea: false },
                ticks: { color: TINTA.eje, stepSize: 20, font: { size: 12 }, callback: function (n) { return n + ' %'; } },
                title: { display: true, text: '% acumulado', color: TINTA.eje, font: { size: 12 } } },
        },
      },
    }).render();
  }

  // Categorias y grupos: barras horizontales, una fila por barra.
  function pintarHorizontal(clave, filas, errores) {
    var v = preparar(clave, filas, errores);
    if (!v) return;
    destruir(clave);
    $('lienzo-' + clave).style.height = Math.max(260, v.filas.length * ALTO_FILA + 40) + 'px';
    graficas[clave] = new DashboardBarChart({
      canvas: $('chart-' + clave),
      etiquetas: v.cortas.map(function (e) { return lineasEje(e); }),
      datos: v.cantidades,
      colores: colores(v),
      formato: function (n) { return NUM.format(n); },
      opciones: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        layout: { padding: { right: 26 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              // La ruta / el nombre COMPLETO, sin abreviar.
              title: function (items) { return items.length ? v.etiquetas[items[0].dataIndex] : ''; },
              label: function (item) {
                var f = v.filas[item.dataIndex];
                return entero(f.CantidadTickets) + ' tickets · ' + pct(f.Porcentaje) +
                       ' · acumulado ' + pct(f.PorcentajeAcumulado);
              },
            },
          },
        },
        scales: {
          x: { beginAtZero: true, grace: '6%', ticks: { precision: 0, color: TINTA.eje }, grid: { color: TINTA.rejilla } },
          y: { ticks: { color: TINTA.etiqueta, autoSkip: false, font: { size: 11.5 } }, grid: { display: false } },
        },
      },
    }).render();
  }

  // ------------------------------------------------------------ peticion
  function pedir(qs) {
    return fetch(API + '?' + qs, { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (resp) {
        return resp.text().then(function (cuerpo) {
          var datos = null;
          try { datos = cuerpo ? JSON.parse(cuerpo) : null; } catch (e) { datos = null; }
          if (!resp.ok) {
            throw new Error(datos && typeof datos.error === 'string'
              ? datos.error : 'El servidor respondió con el código ' + resp.status + '.');
          }
          if (!datos) throw new Error('La respuesta del servidor llegó vacía o con un formato no válido.');
          return datos;
        });
      }, function () {
        throw new Error('No se pudo contactar a concentracion.ashx. Revisa que el sitio esté publicado y en ejecución.');
      });
  }

  var CLAVES = ['pareto', 'categorias', 'grupos'];

  function enEspera() {
    CLAVES.forEach(function (k) { mensaje(k, 'Calculando…'); $('hint-' + k).textContent = ''; });
    DatosInfo.mensaje($('estado'), 'Cargando…');
  }

  function fallo(err) {
    CLAVES.forEach(function (k) { destruir(k); mensaje(k, 'Error al cargar datos.', true); });
    DatosInfo.mensaje($('estado'), 'Error al cargar datos: ' + err.message, err.message);
    $('error-msg').textContent = err.message;
    $('error').hidden = false;
    console.error('[Vista general de servicios]', err);
  }

  /* Opciones de un multiselect desde el servidor ({valor, tickets}), SIN
     perder lo elegido: lo que estaba marcado sigue marcado (el servidor
     devuelve con 0 tickets lo elegido que ya no aparece en el periodo).
     Cambiar las <option> no dispara `change`; el desplegable propio se
     entera por su MutationObserver. */
  function llenarMultiple(sel, opciones, elegidos) {
    var marcados = {};
    (elegidos || []).forEach(function (v) { marcados[v] = true; });
    sel.innerHTML = (opciones || []).map(function (o) {
      return '<option value="' + esc(o.valor) + '"' + (marcados[o.valor] ? ' selected' : '') + '>' +
             esc(o.valor) + ' (' + entero(o.tickets) + ')</option>';
    }).join('');
  }

  function llenarMeses(meses, elegido) {
    $('mes').innerHTML = (meses || []).map(function (m) {
      return '<option value="' + esc(m.valor) + '"' + (m.valor === elegido ? ' selected' : '') + '>' +
             esc(m.etiqueta + (m.enCurso ? ' (en curso)' : '')) + '</option>';
    }).join('');
  }

  // consultado: la hora de esta respuesta buena (DatosInfo.ahoraLocal).
  function pintar(d, consultado) {
    ultima = d;
    var errores = d.errores || {};
    if (numero(d.slotMaximo) !== null) slotMaximo = numero(d.slotMaximo);
    // El servidor confirma el mes cuando se pidio "el actual" sin decir cual.
    if (d.modo === 'mes' && d.mes) filtros.mes = d.mes;
    llenarMeses(d.meses, filtros.mes || (d.meses && d.meses[0] && d.meses[0].valor));
    var op = d.opciones || {};
    llenarMultiple($('f-so'), op.serviceOwners, filtros.so);
    llenarMultiple($('f-grupo'), op.grupos, filtros.grupo);
    $('f-so').disabled = !(op.serviceOwners && op.serviceOwners.length) && !filtros.so.length;
    pintarControles();

    $('activos').textContent = textoActivos(d);
    var cobertura = textoCobertura(d.cobertura);
    $('cobertura').textContent = cobertura;
    $('cobertura').hidden = !cobertura;
    pintarPareto(d.pareto, errores);
    pintarHorizontal('categorias', d.categorias, errores);
    pintarHorizontal('grupos', d.grupos, errores);

    var fallidos = Object.keys(errores);
    DatosInfo.pintar($('estado'), d.dataInfo, fallidos.length ? {
      sufijo: ' · ⚠ sin datos de: ' + fallidos.join(', '),
      titulo: fallidos.map(function (k) { return k + ': ' + errores[k]; }).join('\n'),
      consultado: consultado,
    } : { consultado: consultado });

    var avisos = d.avisos || [];
    $('avisos').hidden = !avisos.length;
    $('avisos').innerHTML = avisos.map(function (a) { return '<div>' + esc(a) + '</div>'; }).join('');
  }

  /* fondo = refresco (el automatico de dashboard.js o "Actualizar"): mismos
     filtros, sin "Calculando…" y, si falla, lo que se ve se queda y la
     pastilla lo avisa. -> Promise (null). */
  var enVuelo = 0, cargadoUnaVez = false;
  function cargar(fondo) {
    fondo = fondo === true;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      fallo(new Error('Esta página necesita el servidor: ábrela desde el sitio publicado en IIS ' +
        'o desde la pestaña Vista general de servicios del tablero.'));
      return Promise.resolve(null);
    }
    var token = ++peticion;
    var qs = consulta(filtros);
    if (!fondo) { $('error').hidden = true; enEspera(); }
    enVuelo++;
    return pedir(qs)
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
          console.error('[Vista general de servicios]', err);
        } else {
          fallo(err);
        }
      })
      .then(function () { enVuelo--; return null; });
  }

  /* Los multiselect: varios cambios seguidos = una sola peticion (como QARE
     y el Backlog). */
  var ESPERA_AUTO = 250;
  var cargaProgramada = null;
  function programarCarga() {
    clearTimeout(cargaProgramada);
    cargaProgramada = setTimeout(function () { cargaProgramada = null; cargar(); }, ESPERA_AUTO);
  }

  // Refresco automatico: nunca encima de una carga en vuelo o programada, ni
  // antes de la primera carga buena. Usa `filtros` tal cual: no resetea nada.
  function refrescar() {
    if (enVuelo > 0 || cargaProgramada !== null || !cargadoUnaVez) return Promise.resolve(null);
    return cargar(true);
  }
  // Boton "Actualizar": igual; sin carga buena todavia, una normal.
  function actualizarAhora() {
    if (enVuelo > 0) return Promise.resolve(null);
    return cargar(cargadoUnaVez);
  }

  // ------------------------------------------------------------- filtros
  // Modo, Slot y Mes en los controles, segun `filtros`.
  function pintarControles() {
    document.querySelectorAll('#conc-filtros [data-modo]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.modo === filtros.modo));
    });
    $('campo-slot').hidden = filtros.modo !== 'slot';
    $('campo-mes').hidden = filtros.modo !== 'mes';
    $('slot-n').value = String(filtros.slot);
    $('slot-menos').disabled = filtros.slot <= 0;
    $('slot-mas').disabled = filtros.slot >= slotMaximo;
  }

  function seleccionados(sel) {
    return Array.prototype.map.call(sel.selectedOptions, function (o) { return o.value; });
  }

  // Cambio de periodo = otra consulta, con "Calculando…" (no es un refresco).
  function cambiarSlot(n) {
    if (n === null || n === filtros.slot) { pintarControles(); return; }
    filtros.slot = n;
    pintarControles();
    $('cobertura').hidden = true;
    cargar();
  }

  function cambiarModo(modo) {
    if (modo === filtros.modo) return;
    filtros.modo = modo;
    pintarControles();
    $('cobertura').hidden = true;
    cargar();
  }

  // "Limpiar" quita Service Owner y Grupo; el periodo se queda.
  function limpiar() {
    if (!filtros.so.length && !filtros.grupo.length) return;
    filtros.so = [];
    filtros.grupo = [];
    [$('f-so'), $('f-grupo')].forEach(function (sel) {
      Array.prototype.forEach.call(sel.options, function (o) { o.selected = false; });
    });
    if (window.Desplegable) Desplegable.repintar();
    cargar();
  }

  function conectar() {
    document.querySelectorAll('#conc-filtros [data-modo]').forEach(function (b) {
      b.addEventListener('click', function () { cambiarModo(b.dataset.modo); });
    });
    $('slot-menos').addEventListener('click', function () { cambiarSlot(Math.max(0, filtros.slot - 1)); });
    $('slot-mas').addEventListener('click', function () { cambiarSlot(Math.min(slotMaximo, filtros.slot + 1)); });
    var campo = $('slot-n');
    campo.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); cambiarSlot(acotarSlot(campo.value, slotMaximo)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cambiarSlot(Math.min(slotMaximo, filtros.slot + 1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); cambiarSlot(Math.max(0, filtros.slot - 1)); }
    });
    campo.addEventListener('change', function () { cambiarSlot(acotarSlot(campo.value, slotMaximo)); });
    $('mes').addEventListener('change', function () {
      if ($('mes').value === filtros.mes) return;
      filtros.mes = $('mes').value;
      $('cobertura').hidden = true;
      cargar();
    });
    $('f-so').addEventListener('change', function () { filtros.so = seleccionados($('f-so')); programarCarga(); });
    $('f-grupo').addEventListener('change', function () { filtros.grupo = seleccionados($('f-grupo')); programarCarga(); });
    $('btn-limpiar').addEventListener('click', limpiar);
    $('reintentar').addEventListener('click', function () { cargar(); });
    if (window.RefrescoAuto) RefrescoAuto.cablearBoton($('btn-actualizar'), actualizarAhora);
  }

  var arrancado = false;
  function arrancar() {
    if (arrancado || !$('chart-pareto')) return;
    arrancado = true;
    Barras.aplicarDefaults();
    /* La capa visual de los <select>. Embebido, el Desplegable.montar(document)
       de dashboard.js ya corrio antes de que existiera este marcado, asi que
       se monta aqui sobre la raiz del modulo (idempotente), como en QARE. */
    if (window.Desplegable) Desplegable.montar(document.getElementById('tab-concentracion') || document);
    pintarControles();
    conectar();
    cargar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  /* Lo unico que el modulo publica hacia fuera, para TableroConcentracion
     (dashboard.js): al volver a la pestaña se remiden las graficas (midieron
     cero con el contenedor oculto) y el refresco automatico. `filtros` es una
     copia, para las pruebas. */
  raiz.TableroConcentracionModulo = {
    redimensionar: function () {
      Object.keys(graficas).forEach(function (k) { if (graficas[k]) graficas[k].resize(); });
    },
    recargar: function () { return cargar(); },
    refrescar: refrescar,
    filtros: function () { return JSON.parse(JSON.stringify(filtros)); },
    slot: function () { return filtros.slot; },
  };
})(window);
