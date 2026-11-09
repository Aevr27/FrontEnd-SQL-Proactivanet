/* =========================================================================
   concentracion/concentracion.js

   Pestaña "Concentracion de tickets". Un solo archivo para la pagina suelta
   (concentracion/concentracion.html) y para la pestaña del tablero, que monta
   ese mismo marcado e inyecta este mismo script (TableroConcentracion en
   dashboard.js).

   Es INDEPENDIENTE de "Analisis de servicios": carga sola al abrirse, sin
   elegir servicio, y no lee ni escribe nada de esa pestaña.

   Todo sale de handlers/concentracion.ashx en UNA peticion por Slot; el
   MISMO Slot va a los tres procedimientos. El handler entrega TODAS las
   filas de cada uno en orden de Posicion (App_Code/ConcentracionContrato.cs),
   con el acumulado ya calculado sobre todas. Aqui solo se recorta al Top 10 /
   15 para pintar.

   Regla de datos: lo que el API no trae no se calcula aqui. Porcentajes,
   acumulado y TotalTickets son los del procedimiento (escala 0-100). Lo
   unico que se deriva es de presentacion: que barras caen antes del 80 %
   (con el acumulado de la fila ANTERIOR, que tambien viene del SP) y la
   etiqueta abreviada de una categoria. El periodo del Slot tambien lo manda
   el servidor (no se calcula con el reloj del navegador).

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

  var ConcentracionDatos = {
    TOP: TOP, UMBRAL: UMBRAL, SLOT_MAXIMO: SLOT_MAXIMO, LARGO_ETIQUETA: LARGO_ETIQUETA,
    numero: numero, etiquetaFila: etiquetaFila, abreviarRuta: abreviarRuta, recortar: recortar,
    marcarDentro: marcarDentro, vista: vista, resumen: resumen, textoPeriodo: textoPeriodo,
    acotarSlot: acotarSlot, lineasEje: lineasEje,
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

  /* Colores. Verde de marca para el volumen (--g-700 dentro del 80 %,
     --g-300 el resto), amarillo para el acumulado y gris discreto para la
     referencia del 80 %. Mismos valores que la leyenda de concentracion.css. */
  var COLOR = { dentro: '#56a333', fuera: '#bae065', acumulado: '#eab308', referencia: '#9aa094' };
  var TINTA = { eje: '#5e5e5f', etiqueta: '#393939', rejilla: '#eef1ea' };

  var graficas = {};
  var slot = 0;
  var slotMaximo = SLOT_MAXIMO;
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
      mensaje(clave, 'Sin tickets en este Slot.');
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
  function pedir(s) {
    return fetch(API + '?slot=' + encodeURIComponent(s), { headers: { 'Accept': 'application/json' }, cache: 'no-store' })
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
    console.error('[Concentracion]', err);
  }

  // consultado: la hora de esta respuesta buena (DatosInfo.ahoraLocal).
  function pintar(d, consultado) {
    var errores = d.errores || {};
    if (numero(d.slotMaximo) !== null) slotMaximo = numero(d.slotMaximo);
    $('periodo').textContent = textoPeriodo(d.periodo);
    pintarPareto(d.pareto, errores);
    pintarHorizontal('categorias', d.categorias, errores);
    pintarHorizontal('grupos', d.grupos, errores);

    var fallidos = Object.keys(errores);
    DatosInfo.pintar($('estado'), d.dataInfo, fallidos.length ? {
      sufijo: ' · ⚠ sin datos de: ' + fallidos.join(', '),
      titulo: fallidos.map(function (k) { return k + ': ' + errores[k]; }).join('\n'),
      consultado: consultado,
    } : { consultado: consultado });
    fallidos.forEach(function (k) { console.error('[Concentracion ' + k + ']', errores[k]); });

    var avisos = d.avisos || [];
    $('avisos').hidden = !avisos.length;
    $('avisos').innerHTML = avisos.map(function (a) { return '<div>' + esc(a) + '</div>'; }).join('');
  }

  /* fondo = refresco (el automatico de dashboard.js o "Actualizar"): mismo
     Slot, sin "Calculando…" y, si falla, lo que se ve se queda y la pastilla
     lo avisa. -> Promise (null). */
  var enVuelo = 0, cargadoUnaVez = false;
  function cargar(fondo) {
    fondo = fondo === true;
    if (location.protocol !== 'http:' && location.protocol !== 'https:') {
      fallo(new Error('Esta página necesita el servidor: ábrela desde el sitio publicado en IIS ' +
        'o desde la pestaña Concentración de tickets del tablero.'));
      return Promise.resolve(null);
    }
    var token = ++peticion;
    var pedido = slot;
    if (!fondo) { $('error').hidden = true; enEspera(); }
    enVuelo++;
    return pedir(pedido)
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
          console.error('[Concentracion]', err);
        } else {
          fallo(err);
        }
      })
      .then(function () { enVuelo--; return null; });
  }

  // Refresco automatico: nunca encima de una carga en vuelo ni antes de la
  // primera carga buena.
  function refrescar() {
    if (enVuelo > 0 || !cargadoUnaVez) return Promise.resolve(null);
    return cargar(true);
  }
  // Boton "Actualizar": igual; sin carga buena todavia, una normal.
  function actualizarAhora() {
    if (enVuelo > 0) return Promise.resolve(null);
    return cargar(cargadoUnaVez);
  }

  // ---------------------------------------------------------------- Slot
  function pintarSlot() {
    $('slot-n').value = String(slot);
    $('slot-menos').disabled = slot <= 0;
    $('slot-mas').disabled = slot >= slotMaximo;
  }

  // Cambiar de Slot = otra consulta, con "Calculando…" (no es un refresco).
  function cambiarSlot(n) {
    if (n === null || n === slot) { pintarSlot(); return; }
    slot = n;
    pintarSlot();
    $('periodo').textContent = '';
    cargar();
  }

  function conectar() {
    $('slot-menos').addEventListener('click', function () { cambiarSlot(Math.max(0, slot - 1)); });
    $('slot-mas').addEventListener('click', function () { cambiarSlot(Math.min(slotMaximo, slot + 1)); });
    var campo = $('slot-n');
    campo.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); cambiarSlot(acotarSlot(campo.value, slotMaximo)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); cambiarSlot(Math.min(slotMaximo, slot + 1)); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); cambiarSlot(Math.max(0, slot - 1)); }
    });
    campo.addEventListener('change', function () { cambiarSlot(acotarSlot(campo.value, slotMaximo)); });
    $('reintentar').addEventListener('click', function () { cargar(); });
    if (window.RefrescoAuto) RefrescoAuto.cablearBoton($('btn-actualizar'), actualizarAhora);
  }

  var arrancado = false;
  function arrancar() {
    if (arrancado || !$('chart-pareto')) return;
    arrancado = true;
    Barras.aplicarDefaults();
    pintarSlot();
    conectar();
    cargar();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', arrancar);
  else arrancar();

  /* Lo unico que el modulo publica hacia fuera, para TableroConcentracion
     (dashboard.js): al volver a la pestaña se remiden las graficas (midieron
     cero con el contenedor oculto) y el refresco automatico. */
  raiz.TableroConcentracionModulo = {
    redimensionar: function () {
      Object.keys(graficas).forEach(function (k) { if (graficas[k]) graficas[k].resize(); });
    },
    recargar: function () { return cargar(); },
    refrescar: refrescar,
    slot: function () { return slot; },
  };
})(window);
