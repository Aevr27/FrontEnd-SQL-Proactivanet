/* =========================================================================
   dashboard.js

   JavaScript del tablero. Extraido de dashboard.html, que ahora lo carga
   con <script src="dashboard.js"> en vez de llevarlo incrustado.

   Contiene el bloque grande: datos de demostracion, capa de acceso a los
   .ashx, render de KPIs, graficas y tablas de las pestanas de SLA,
   productividad, backlog y tableros extra.

   Experiencia y QA no estan aqui: son modulos propios (experiencia/ y qa/)
   con su pagina, su hoja y su script, que ademas siguen funcionando sueltos.
   De ellos este archivo solo tiene el montaje perezoso (moduloEmbebido).

   El arranque (activarTab del hash inicial) NO vive aqui: sigue siendo un
   <script> aparte al final de dashboard.html, a proposito, para que
   sobreviva a un error de parseo o ejecucion de este archivo.

   Chart.js es dependencia externa (CDN) y se carga desde el HTML.
   ========================================================================= */

/* =======================================================================
   1. Preambulo compartido
   ======================================================================= */

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

const FMT = n => (n === null || n === undefined || n === '') ? '' : Number(n).toLocaleString('es-MX');
const PCT = (parte, total) => total > 0 ? Math.round(100 * parte / total) + '%' : '—';

/* =========================================================================
   PALETA DE GRAFICAS — derivada de la escala verde de la cabecera.

   Las tres paradas del degradado de header.top son la fuente:
     #9DD323 (lima) · #65BB2B (verde de marca) · #478B3C (verde profundo)
   Todo lo demas son interpolaciones y tintes de esa recta. Los mismos
   valores viven en el bloque :root de dashboard.css (--g-300 ... --g-900):
   al retocar la escala hay que tocar los dos archivos.

   Rojo y ambar se conservan donde el dato es negativo o de advertencia.
   ========================================================================= */
/* La MARCA (cabecera, botones, pestañas) usa los verdes del degradado tal
   cual: #9DD323 / #65BB2B / #478B3C. Esos tres son muy claros para rellenar
   una barra sobre blanco -el lima queda en 1.7:1-, asi que la familia de
   GRAFICAS es la misma escala re-escalonada para que cada relleno se lea
   sobre la superficie blanca. Misma identidad verde, distinto trabajo. */
const VERDE = {
  lima:    '#8cbf1e',   // lima de datos  (hermano de #9DD323)
  marca:   '#5aa726',   // verde de datos (hermano de #65BB2B)
  pino:    '#2f8f6b',   // verde pino: el otro verde, no un azul
  profundo:'#356b2c',   // verde profundo (hermano de #478B3C)
  claro:   '#78c96b',
};
const ROJO_SEM = '#982a18';   // negativo
const AMBAR_SEM = '#d97706';  // advertencia
const NEUTRO_SEM = '#8a8578'; // referencia / sin dato

/* ---------------------------------------------------------------------
   PALETA CATEGORICA — identidad de serie.

   Ya NO se define aqui: vive en assets/js/paleta.js (window.Paleta) y la
   comparten los cuatro tableros -SLA, Backlog, QA y Experiencia- mas
   Orquestacion, para que una categoria conserve su color pase donde pase.
   Ese archivo explica como consumirla en una grafica nueva; el atajo es
   Paleta.escala(orden) / Paleta.color(clave, orden) / Paleta.registro(n).

   Ojo: la paleta categorica es IDENTIDAD. El semaforo, COLOR_PRIORIDAD y
   RAMPA_ORDINAL de aqui abajo son ESTADO y ORDEN: no salen de la paleta
   compartida y no deben migrarse a ella.
   --------------------------------------------------------------------- */

/* Rampa ORDINAL — para dimensiones con orden propio (antiguedad). Un solo
   tono, de claro a oscuro, para que el orden se vea en el color. Validada
   con --ordinal: luminosidad monotona, saltos >= 0.06 y extremo claro a
   2.13:1. El cubo "Sin fecha" no es parte del orden: va en neutro. */
const RAMPA_ORDINAL = ['#8cbf1e', '#6bad24', '#4f9528', '#387d2a', '#256425', '#144819'];

/* Severidad = progresion, y la progresion es la del SEMAFORO: Baja lima y
   Media verde de marca son territorio tranquilo, Alta pasa a ambar -ya es
   advertencia, no un verde mas oscuro- y Critica se queda en el rojo
   semantico. Antes Alta era verde profundo: el color decia "esto va bien"
   de un ticket que ya pide atencion, y solo el rotulo del eje contaba la
   diferencia. */
const COLOR_PRIORIDAD = {
  'Critica': ROJO_SEM, 'Crítica': ROJO_SEM,
  'Alta': AMBAR_SEM, 'Media': VERDE.marca, 'Baja': VERDE.lima
};

/* Semaforo de severidad ORIGINAL -rojo / naranja / oro / verde-, el juego con
   el que nacio el tablero (ver e58add5) y el unico que lee de un vistazo sin
   el rotulo del eje: Critica roja, Alta naranja, Media oro, Baja verde.
   Vive aparte de COLOR_PRIORIDAD a proposito: SOLO lo usa "Por prioridad" del
   Backlog (chart-prioridad-bl). El resto del tablero -chart-prioridad de la
   vista de SLA- sigue con COLOR_PRIORIDAD y su escala verde de marca, asi que
   tocar uno no repinta el otro. */
const COLOR_PRIORIDAD_SEMAFORO = {
  'Critica': '#dc2626', 'Crítica': '#dc2626',
  'Alta': '#d97706', 'Media': '#eab308', 'Baja': '#16a34a'
};

// Semaforo de tres niveles: devuelve el sufijo de clase (.kpi.sv/.sa/.sr).
const SEM = pct => pct >= 90 ? 'sv' : (pct >= 75 ? 'sa' : 'sr');
const COLOR_SEM = { sv: VERDE.profundo, sa: AMBAR_SEM, sr: ROJO_SEM };

/* Ejes, rejilla y leyendas de Chart.js: carbon y gris verdoso, a juego con
   la tinta del tablero. Solo toca la presentacion por defecto; cualquier
   grafica que ya declare su propio `ticks`/`grid` sigue mandando. */
if (typeof Chart !== 'undefined') {
  Chart.defaults.color = '#393939';
  Chart.defaults.borderColor = '#f2f5ed';
  if (Chart.defaults.scale && Chart.defaults.scale.grid) {
    Chart.defaults.scale.grid.color = '#f2f5ed';
    // La rejilla es referencia, no estructura: sin las marquitas del eje
    // ni la linea del borde, las barras quedan sobre una cuadricula suave.
    Chart.defaults.scale.grid.drawTicks = false;
    Chart.defaults.scale.grid.tickLength = 8;
  }
  /* Geometria de barra, para TODAS las barras del tablero. Antes aqui vivia
     un juego propio -tope de 26px y .78/.86 de ranura- que dejaba palitos, y
     las graficas que querian barra de verdad tenian que declarar
     Barras.GRUESA una por una; las de Call Center nunca lo hicieron y se
     quedaron distintas. Ahora el default ES el juego compartido
     (assets/js/barras.js): mismo grosor, mismo aire y mismo radio en SLA,
     Backlog, Call Center, QA y Experiencia sin repetir nada.

     Solo toca `Chart.defaults.datasets.bar`: linea, dona y pastel no lo
     miran. Es presentacion: no cambia datos, escalas ni eventos, y el
     dataset que declare lo suyo sigue mandando. */
  Barras.aplicarDefaults();
  if (Chart.defaults.plugins && Chart.defaults.plugins.legend) {
    Chart.defaults.plugins.legend.labels = Object.assign(
      {}, Chart.defaults.plugins.legend.labels, { color: '#393939', boxWidth: 12, boxHeight: 12 });
  }
  if (Chart.defaults.plugins && Chart.defaults.plugins.tooltip) {
    Object.assign(Chart.defaults.plugins.tooltip, {
      backgroundColor: 'rgba(25, 25, 25, .92)',
      borderColor: '#478b3c', borderWidth: 1,
    });
  }
}
const miniBar = (pct, color) =>
  `<span class="mini" title="${Math.round(pct)}%"><i style="width:${Math.max(0,Math.min(100,pct))}%;background:${color}"></i></span>`;

// Saca el mensaje util de una pagina de error de ASP.NET/IIS. Sin esto, al
// quitar solo las etiquetas quedaba el CSS de la propia pagina de error
// ('body {font-family:"Verdana"...') y el mensaje real se perdia.
function resumirHtmlError(html) {
  const texto = String(html)
    .replace(/\x3Chead[\s\S]*?\x3C\/head\x3E/gi, ' ')
    .replace(/\x3Cstyle[\s\S]*?\x3C\/style\x3E/gi, ' ')
    .replace(/\x3Cscript[\s\S]*?\x3C\/script\x3E/gi, ' ')
    .replace(/\x3C!--[\s\S]*?--\x3E/g, ' ')
    .replace(/\x3C[^\x3E]*\x3E/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
  return texto.slice(0, 400) || 'sin detalle en la respuesta';
}


/* ---- Cross-filter: piezas identicas en los tableros de SLA y de Backlog ----
   Los dos llevan su propio objeto `filtro` (dimensiones distintas), pero lo
   consultan, lo pintan y lo limpian igual. Estas funciones reciben ese objeto
   en vez de duplicarse dentro de cada modulo. */

// Pares [dimension, valor] con filtro puesto. null = esa dimension no filtra.
function dimensionesActivas(filtro) {
  return Object.entries(filtro).filter(([, v]) => v !== null);
}

// Fila de tarjetas de KPI. t = { l: etiqueta, v: valor, f: pie, s: semaforo }.
function htmlTarjetasKpi(tarjetas) {
  return tarjetas.map(t => `
    <div class="kpi ${t.s ?? ''}">
      <div class="lbl">${t.l}</div>
      <div class="val">${t.v}</div>
      <div class="foot">${t.f ?? ''}</div>
    </div>`).join('');
}

/* =======================================================================
   MODO DE PRUEBA LOCAL — datos simulados para validar graficas/UI.
   Toda la implementacion (datos, generadores, filtros y caches) vive en
   mock-data.js, que el HTML carga ANTES que este archivo y publica en
   window.MockData. El interruptor unico sigue siendo la constante
   MOCK_DATA declarada alli: true = datos simulados, false = .ashx reales.
   Aqui solo queda el enganche dentro de obtenerJSON().
   ======================================================================= */

/* -----------------------------------------------------------------------
   Ruteo de los handlers .ashx.
   Los .ashx viven en handlers/, junto a este HTML (catalogos.ashx,
   kpis.ashx, tendencia.ashx, productividad.ashx, distribucion.ashx,
   detalle.ashx, backlog_catalogos.ashx, backlog_resumen.ashx,
   backlog_historico.ashx). Una ruta relativa suelta se resuelve contra la
   URL del documento, y eso falla cuando IIS sirve la pagina como documento
   por defecto sin barra final (https://host/tablero -> pide /kpis.ashx en la
   raiz del sitio). Anclar contra la carpeta del propio HTML deja las
   llamadas apuntando siempre a los archivos de al lado.
   BASE_ASHX permite mover los handlers a otra carpeta sin tocar el resto.
   ----------------------------------------------------------------------- */
const BASE_ASHX = 'handlers/';

function urlHandler(ruta) {
  if (/^(https?:)?\/\//i.test(ruta) || ruta.startsWith('/')) return ruta;
  let base = document.baseURI;
  // Si la URL no termina en / ni en un archivo con extension, IIS la esta
  // sirviendo como carpeta: se le agrega la barra para no subir un nivel.
  const ruta0 = new URL(base).pathname;
  if (!ruta0.endsWith('/') && !/\.[a-z0-9]+$/i.test(ruta0.split('/').pop())) base += '/';
  const carpeta = new URL('.', base);
  return new URL(BASE_ASHX + ruta, carpeta).href;
}

async function obtenerJSON(ruta) {
  if (window.MockData && window.MockData.MOCK_DATA) return window.MockData.obtenerJSONMock(ruta);
  const resp = await fetch(urlHandler(ruta), { cache: 'no-store' });
  const texto = await resp.text();

  // Los handlers .ashx devuelven el error como JSON ({error, tipo}), asi que
  // se puede mostrar la causa real en pantalla.
  let datos = null;
  try { datos = JSON.parse(texto); } catch (e) { /* no era JSON */ }

  if (!resp.ok) {
    throw new Error(`${ruta} -> HTTP ${resp.status}. ${(datos && datos.error) || resumirHtmlError(texto)}`);
  }
  if (datos === null) throw new Error(`${ruta} -> la respuesta no es JSON.`);
  return datos;
}

/* -----------------------------------------------------------------------
   detalle.ashx serializa con JavaScriptSerializer, que trae un tope de
   longitud (maxJsonLength, 2 MB por omision). Con rangos grandes la
   respuesta lo revienta y el handler responde HTTP 500 con
   "The length of the string exceeds the value set on the maxJsonLength
   property" -no llega ni una fila-.

   El SP no tiene parametro de paginado, pero si de fechas: se parte el
   rango en mitades y se piden por tramos, concatenando el resultado. Solo
   se trocea cuando la respuesta completa falla, asi que en rangos chicos
   se sigue haciendo una unica llamada como antes.
   ----------------------------------------------------------------------- */
const ERROR_JSON_LARGO = /maxJsonLength|length of the string exceeds/i;
const TOPE_DETALLE_MINIMO = 250;
const PROFUNDIDAD_MAX_TRAMOS = 6;

function diaISO(d) { return new Date(d).toISOString().slice(0, 10); }

// Punto de corte del rango. Devuelve null si no se puede partir (falta
// alguna fecha o el rango ya es de un solo dia).
function puntoMedio(desde, hasta) {
  if (!desde || !hasta) return null;
  const a = Date.parse(desde + 'T00:00:00Z'), b = Date.parse(hasta + 'T00:00:00Z');
  if (isNaN(a) || isNaN(b) || b <= a) return null;
  const medio = a + Math.floor((b - a) / 2);
  const corte = diaISO(medio);
  return (corte === hasta) ? null : corte;
}

function diaSiguiente(fecha) {
  return diaISO(Date.parse(fecha + 'T00:00:00Z') + 86400000);
}

async function obtenerDetalle(params, tope) {
  async function tramo(desde, hasta, topeTramo, profundidad) {
    const p = new URLSearchParams(params);
    if (desde) p.set('fecha_inicio', desde); else p.delete('fecha_inicio');
    if (hasta) p.set('fecha_fin', hasta); else p.delete('fecha_fin');
    p.set('top', String(topeTramo));
    try {
      return await obtenerJSON(`detalle.ashx?${p.toString()}`);
    } catch (e) {
      if (!ERROR_JSON_LARGO.test(String(e && e.message))) throw e;

      const corte = (profundidad < PROFUNDIDAD_MAX_TRAMOS) ? puntoMedio(desde, hasta) : null;
      if (corte) {
        // Secuencial a proposito: dos mitades en paralelo duplican la carga
        // del SP, que ya es la parte lenta.
        const primera = await tramo(desde, corte, topeTramo, profundidad + 1);
        const segunda = await tramo(diaSiguiente(corte), hasta, topeTramo, profundidad + 1);
        return primera.concat(segunda);
      }
      // Un solo dia (o sin fechas) que aun asi no cabe: se pide menos
      // detalle en vez de quedarse sin nada.
      if (topeTramo <= TOPE_DETALLE_MINIMO) throw e;
      return tramo(desde, hasta, Math.max(TOPE_DETALLE_MINIMO, Math.floor(topeTramo / 2)), profundidad + 1);
    }
  }

  const filas = await tramo(params.get('fecha_inicio'), params.get('fecha_fin'), tope, 0);
  // Los tramos vienen en orden cronologico; el tablero asume mas recientes
  // primero, igual que cuando responde una sola llamada. "Reciente" es por
  // fecha de solucion, que es por la que filtra y ordena detalle.ashx; si el
  // backend aun no la manda, se cae a la de registro como antes.
  const clave = r => String(r.FechaFirmaSolucion || r.FechaRegistro || '');
  return filas.sort((a, b) => clave(b).localeCompare(clave(a)));
}

function seleccionados(id) {
  return Array.from(document.getElementById(id).selectedOptions).map(o => o.value);
}

function estadoCargando(id) { document.getElementById(id).textContent = 'Cargando...'; }

// Sello del ultimo ETL (kpis.ashx -> UltimaActualizacionEtl), que ya llega en
// hora local de Mexico como 'yyyy-MM-ddTHH:mm:ss'. Se parte el texto en vez de
// usar new Date(): el navegador interpretaria la cadena sin zona como local y
// la recorreria si la maquina no esta en la zona de Mexico.
function formatoSelloEtl(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(iso || ''));
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : null;
}

// Sin sello del ETL (pestana de backlog, o EtlLog sin filas) se mantiene la
// hora del navegador como antes.
function estadoOk(id, selloEtl) {
  const sello = formatoSelloEtl(selloEtl);
  document.getElementById(id).textContent = sello
    ? `Última actualización: ${sello}`
    : `Actualizado ${new Date().toLocaleTimeString('es-MX')}`;
}
function estadoError(id, err) {
  const el = document.getElementById(id);
  el.textContent = `Error al cargar datos: ${err.message}`;
  el.title = err.message;
  console.error(err);
}

// Carga parcial: el tablero pinta lo que si llego y dice, sin esconderlo, que
// datasets se quedaron fuera. `fallos` = [{ nombre, error }]. Sin fallos se
// comporta exactamente como estadoOk().
function estadoParcial(id, selloEtl, fallos) {
  estadoOk(id, selloEtl);
  if (!fallos || !fallos.length) return;
  const el = document.getElementById(id);
  const nombres = fallos.map(f => f.nombre).join(', ');
  el.textContent += ` · ⚠ sin datos de: ${nombres}`;
  el.title = fallos.map(f => `${f.nombre}: ${f.error && f.error.message}`).join('\n');
  fallos.forEach(f => console.error(`[${f.nombre}]`, f.error));
}

/* Instrumentacion del ciclo de repintado. Apagada por omision: se enciende
   desde la consola con `window.DEBUG_PERF = true` y se apaga igual, sin
   recargar. Sirve para medir el coste real de un clic de cross-filter. */
const perf = {
  ini(nombre) { if (window.DEBUG_PERF) console.time(nombre); },
  fin(nombre) { if (window.DEBUG_PERF) console.timeEnd(nombre); },
};

// Ordena el <tbody> al hacer clic en un <th>. Las columnas class="num" se
// comparan como numero (si no, 9 quedaria despues de 100).
function hacerOrdenable(tabla) {
  if (!tabla || !tabla.tHead || !tabla.tBodies.length) return;
  const ths = Array.from(tabla.tHead.rows[0].cells);
  ths.forEach((th, i) => {
    th.addEventListener('click', () => {
      const asc = th.dataset.orden !== 'asc';
      ths.forEach(o => {
        delete o.dataset.orden;
        const marca = o.querySelector('.ord');
        if (marca) marca.remove();
      });
      th.dataset.orden = asc ? 'asc' : 'desc';
      th.insertAdjacentHTML('beforeend', `<span class="ord">${asc ? '▲' : '▼'}</span>`);

      const numerica = th.classList.contains('num');
      const cuerpo = tabla.tBodies[0];
      const valor = fila => (fila.cells[i] ? fila.cells[i].textContent.trim() : '');
      Array.from(cuerpo.rows)
        .sort((a, b) => {
          const x = valor(a), y = valor(b);
          const cmp = numerica
            ? (parseFloat(x.replace(/[^\d.-]/g, '')) || 0) - (parseFloat(y.replace(/[^\d.-]/g, '')) || 0)
            : x.localeCompare(y, 'es');
          return asc ? cmp : -cmp;
        })
        .forEach(fila => cuerpo.appendChild(fila));
    });
  });
}

// Las graficas creadas dentro de un panel oculto nacen con tamaño 0: Chart.js
// mide el canvas al construirlo y display:none lo deja en cero.
function redimensionar(graficos) {
  Object.values(graficos).forEach(g => { if (g) g.resize(); });
}

function activarSubtabs(contenedor, alMostrar) {
  contenedor.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      contenedor.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === tab));
      contenedor.querySelectorAll('.panel').forEach(p =>
        p.classList.toggle('active', p.id === tab.dataset.panel));
      if (alMostrar) alMostrar(tab.dataset.panel);
    });
  });
}

// Cuenta filas agrupando por una funcion de clave. Devuelve un Map ordenado
// de mayor a menor, salvo que se pase un orden canonico.
function contarPor(filas, clave, ordenCanonico) {
  const m = new Map();
  for (const f of filas) {
    const k = clave(f);
    if (k === null || k === undefined || k === '') continue;
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  const ent = [...m.entries()];
  if (ordenCanonico) {
    const pos = v => { const i = ordenCanonico.indexOf(v); return i < 0 ? 999 : i; };
    ent.sort((a, b) => pos(a[0]) - pos(b[0]));
  } else {
    ent.sort((a, b) => b[1] - a[1]);
  }
  return ent;
}

// Devuelve la etiqueta sobre la que se hizo clic en una grafica, o null.
function etiquetaDelClic(gr, evento) {
  const els = gr.getElementsAtEventForMode(evento, 'nearest', { intersect: true }, true);
  if (!els.length) return null;
  return gr.data.labels[els[0].index] ?? null;
}

// Resalta con un contorno oscuro el elemento seleccionado de una grafica.
function bordesSeleccion(etiquetas, seleccionada, grosorNormal) {
  return {
    borderColor: etiquetas.map(e => e === seleccionada ? '#191919' : '#fff'),
    borderWidth: etiquetas.map(e => e === seleccionada ? 3 : grosorNormal),
  };
}

/* Pinta una grafica reusando la instancia viva cuando solo cambiaron los datos.
   Reconstruir (destroy + new Chart) es la parte cara del cross-filter: Chart.js
   vuelve a medir el canvas, recrea escalas y anima desde cero en cada clic.
   `construir()` devuelve la config completa (primera vez, o si el canvas quedo
   con un mensaje de "sin datos"); `actualizar(grafico)` solo escribe labels y
   datasets sobre la instancia existente.
   `update('none')` salta la animacion SOLO en el repintado; la construccion
   inicial conserva la animacion de siempre. */
function dibujarGrafico(graficos, id, canvasId, construir, actualizar) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return null;

  const vivo = graficos[id];
  // renderEmptyChart() destruye la instancia y repinta el canvas a mano, asi
  // que no basta con que `graficos[id]` exista: tiene que seguir siendo la
  // grafica que Chart.js reconoce sobre ESE canvas.
  const reusable = vivo && vivo.canvas === canvas && Chart.getChart(canvas) === vivo;

  if (reusable) {
    actualizar(vivo);
    vivo.update('none');
    return vivo;
  }

  if (vivo) { vivo.destroy(); delete graficos[id]; }
  graficos[id] = new Chart(canvas, construir());
  return graficos[id];
}

// Chart.js core no trae plugin de datalabels: este dibuja la cantidad dentro
// de cada segmento de una barra apilada -un numero por color-. Los segmentos
// donde la cifra no cabe se dejan al tooltip.
//
// Sirve para los dos ejes. Con el eje normal la pila crece hacia arriba y el
// segmento va de `base` a `y`; con indexAxis 'y' crece hacia la derecha y va
// de `base` a `x`. Se mide la CAJA del segmento -alto y ancho- en vez de solo
// el largo: una pila de 24 horas da segmentos altos pero angostos, donde un
// "1.234" se salia por los costados encima de los vecinos.
const ETIQUETAS_SEGMENTO = {
  id: 'etiquetasSegmento',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
    const horizontal = chart.options && chart.options.indexAxis === 'y';
    const ALTO_TEXTO = 14;   // alto minimo de caja para que quepa la cifra
    const AIRE = 6;          // margen a los costados, dentro del segmento
    ctx.save();
    ctx.font = 'bold 11px system-ui, -apple-system, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      meta.data.forEach((barra, j) => {
        const v = ds.data[j];
        if (!v) return;
        const base = barra.base ?? 0;
        const largo = Math.abs(base - (horizontal ? barra.x : barra.y));
        const grueso = Math.abs(horizontal ? barra.height : barra.width);
        const alto = horizontal ? grueso : largo;
        const ancho = horizontal ? largo : grueso;
        const texto = FMT(v);
        if (alto < ALTO_TEXTO) return;
        if (ancho < ctx.measureText(texto).width + AIRE * 2) return;
        const x = horizontal ? (base + barra.x) / 2 : barra.x;
        const y = horizontal ? barra.y : (base + barra.y) / 2;
        // Contorno oscuro: el mismo numero se lee sobre cualquier color de la paleta.
        ctx.strokeStyle = 'rgba(25,25,25,.72)';
        ctx.lineWidth = 3;
        ctx.strokeText(texto, x, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(texto, x, y);
      });
    });
    ctx.restore();
  },
};

/* Cifra DENTRO de la barra, para las barras SIMPLES (no apiladas). Es el
   plugin COMPARTIDO de assets/js/barras.js, el mismo que usan las barras de
   Experiencia: se le ata el FMT de este tablero y ya. Las apiladas siguen con
   ETIQUETAS_SEGMENTO de aqui arriba, que sabe de segmentos. */
const ETIQUETAS_DENTRO = Barras.etiquetasDentro(FMT);

// Estado vacio de una grafica. Chart.js no dibuja nada util con datasets
// vacios -deja los ejes solos, que se leen como si hubiera un error-, asi que
// aqui se destruye la instancia y se escribe el motivo centrado en el canvas.
// Devuelve true siempre, para poder cortar el render con
// `if (!filas.length) return renderEmptyChart(id, '...');`.
function renderEmptyChart(canvasId, message) {
  const canvas = document.getElementById(canvasId);
  if (!canvas) return true;

  // Si quedaba una grafica viva en este canvas hay que matarla: si no, Chart.js
  // deja su dibujo y sus listeners de clic encima del mensaje.
  const previo = Chart.getChart(canvas);
  if (previo) previo.destroy();

  // Chart.js deja un ancho en pixeles inline sobre el canvas. Hay que soltarlo
  // ANTES de medir: si se vuelve a fijar en px, el canvas deja de encoger y
  // revienta la rejilla de tarjetas. Con width:100% el canvas se adapta al
  // .lienzo y solo el alto se fija a mano.
  canvas.removeAttribute('style');
  canvas.style.display = 'block';
  canvas.style.width = '100%';

  const caja = canvas.parentElement;
  const altoCaja = (caja && caja.clientHeight) || 0;
  const alto = altoCaja > 20 ? altoCaja : 180;
  canvas.style.height = alto + 'px';

  const ancho = canvas.clientWidth || (caja && caja.clientWidth) || 320;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(ancho * dpr);
  canvas.height = Math.round(alto * dpr);

  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, ancho, alto);
  // Gris medio: se lee igual sobre el tema claro y el oscuro.
  ctx.fillStyle = '#9aa094';
  ctx.font = '13px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lineas = envolverTexto(ctx, String(message ?? 'Sin datos.'), ancho - 32);
  const salto = 18;
  const y0 = alto / 2 - (lineas.length - 1) * salto / 2;
  lineas.forEach((linea, i) => ctx.fillText(linea, ancho / 2, y0 + i * salto));
  return true;
}

// Parte un texto en lineas que quepan en anchoMax, midiendo con el mismo ctx
// que lo va a dibujar.
function envolverTexto(ctx, texto, anchoMax) {
  const palabras = String(texto).split(/\s+/).filter(Boolean);
  if (!palabras.length) return [''];
  const lineas = [];
  let actual = palabras[0];
  for (const palabra of palabras.slice(1)) {
    const prueba = actual + ' ' + palabra;
    if (ctx.measureText(prueba).width <= anchoMax) actual = prueba;
    else { lineas.push(actual); actual = palabra; }
  }
  lineas.push(actual);
  return lineas;
}

/* =======================================================================
   2. Tablero de SLA y productividad
   ======================================================================= */
/* ===================================================================== *
 * Fechas: formato canonico
 * ===================================================================== */

// aaaa-mm-dd, el unico formato que viaja a los handlers. Estaba dentro de
// TableroSla; vive aqui porque lo usan los dos tableros. Su comportamiento
// no cambio.
function formatoFecha(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function hoyISO() {
  return formatoFecha(new Date());
}

/* Las columnas DATE llegan como "2026-08-01T00:00:00": SqlDataReader las
   entrega como DateTime y DashboardDb las serializa con hora. Puesta tal cual
   de etiqueta en el eje X, la hora ocupa mas que la fecha y no dice nada. */
function soloFecha(v) {
  return String(v ?? '').slice(0, 10);
}

const TableroSla = (function () {
  // El SP topea el detalle en 5000 filas (@TopSeguro). Se pide el maximo
  // porque el cross-filter de las graficas se calcula sobre estas filas.
  // Bajar este numero solo reduce cobertura; no requiere tocar el backend.
  const TOPE_DETALLE = 500;

  /* Series con nombre fijo de la tendencia. Creados y Cerrados son IDENTIDAD
     y salen de la paleta categorica compartida (assets/js/paleta.js), en
     posiciones fijas para que no cambien si manana se agrega una serie.
     Vencidos SLA es ESTADO, no identidad: conserva el rojo semantico y por
     eso NO toma la posicion 2 de la paleta -que tambien es roja-. */
  const AZUL = Paleta.porIndice(0), VERDE_S = Paleta.porIndice(2), ROJO = ROJO_SEM,
        MORADO = Paleta.porIndice(4), GRIS = Paleta.NEUTRO;
  /* Barras apiladas de productividad: mismas dos posiciones categoricas que
     Creados/Cerrados arriba, para que las dos tarjetas se lean igual. */
  const BARRA_A = Paleta.porIndice(0), BARRA_B = Paleta.porIndice(2);
  /* Aqui estaban REG_ESTADO, ORDEN_AGING y colorAging(), de las graficas de
     Estado y Antiguedad. Se retiraron: describian la situacion ACTUAL de los
     tickets, que es la pregunta del Backlog, y la pestaña ahora mide lo
     resuelto. El Backlog tiene su propio orden de antiguedad y no dependia
     de nada de esto. */

  const graficos = {};
  let datos = null;
  // false cuando detalle.ashx no pudo cargarse: los agregados del servidor
  // siguen pintandose, pero el cross-filter por clic queda deshabilitado.
  let detalleDisponible = false;
  // Rangos del eje X cuando la tendencia va agrupada en bloques -por SLOT o
  // por mes- (null = diaria). Vive fuera de renderTendencia() para que el
  // callback del tooltip sea siempre el mismo objeto y la grafica se pueda
  // actualizar sin reconstruirla.
  let rangosBucketVigente = null;
  // Presentacion vigente del eje X de la tendencia (ver estiloTendencia). Vive
  // fuera de renderTendencia() por el mismo motivo que rangosBucketVigente: el
  // callback del tick la lee al DIBUJAR, asi que pasar de la vista de 12 SLOTs
  // a la de un año no obliga a reconstruir la grafica.
  let estiloTendVigente = { pointRadius: 3, pointHoverRadius: 6, centrado: false, textos: [] };
  // Dimensiones de cross-filter. null = sin filtrar por esa dimension.
  // 'estado' y 'aging' se fueron con sus graficas: sin donde hacer clic,
  // dejarlas solo daria un filtro fantasma que nada puede apagar.
  const filtro = { prioridad: null, sla: null };

  const ETIQUETA_DIM = { prioridad: 'Prioridad', sla: 'SLA' };

  // Etiqueta de respaldo cuando el campo viene vacio. Es exactamente la
  // misma que emite distribucion.ashx (ISNULL(NULLIF(...))), asi que una
  // rebanada agregada por el servidor y la misma rebanada recalculada sobre
  // `detalle` se llaman igual y el cross-filter por clic casa en los dos casos.
  const SIN_VALOR = { prioridad: 'Sin prioridad' };

  const txt = v => String(v ?? '').trim();

  const VALOR_DIM = {
    prioridad: r => txt(r.Prioridad) || SIN_VALOR.prioridad,
    sla:       r => (r.SlaVencido === true || r.SlaVencido === 1) ? 'Vencido'
                  : (r.DentroSla === true || r.DentroSla === 1) ? 'Dentro' : 'N/D',
  };

  function hayFiltro() { return dimensionesActivas(filtro).length > 0; }

  // Filas que pasan todas las dimensiones activas. `omitir` deja fuera una
  // dimension: es lo que permite que la grafica sobre la que se hizo clic
  // siga mostrando todas sus rebanadas mientras las demas se recalculan.
  function calcularFilas(omitir) {
    const todas = (datos && datos.detalle) || [];
    return todas.filter(r => {
      for (const dim of Object.keys(filtro)) {
        if (dim === omitir) continue;
        const v = filtro[dim];
        if (v === null) continue;
        if (VALOR_DIM[dim](r) !== v) return false;
      }
      return true;
    });
  }

  /* Cache de un ciclo de repintado. Un solo renderTodo() llama a filas() hasta
     seis veces (KPIs, tendencia, productividad y las tres dimensiones) con el
     mismo estado de filtro; solo cambia `omitir`. Se calcula una vez por clave
     y se reusa. La firma del filtro invalida la cache sola en cuanto cambia
     una dimension, y cargarTodo() la vacia al traer detalle nuevo. */
  const cacheFilas = new Map();
  let firmaCache = null;

  function firmaFiltro() {
    return Object.keys(filtro).map(k => `${k}=${filtro[k] ?? ''}`).join('|');
  }

  function invalidarFilas() { cacheFilas.clear(); firmaCache = null; }

  function filas(omitir) {
    const firma = firmaFiltro();
    if (firma !== firmaCache) { cacheFilas.clear(); firmaCache = firma; }
    const clave = omitir ?? '';
    if (!cacheFilas.has(clave)) {
      perf.ini(`filas(${clave || 'todas'})`);
      cacheFilas.set(clave, calcularFilas(omitir));
      perf.fin(`filas(${clave || 'todas'})`);
    }
    return cacheFilas.get(clave);
  }

  // distribucion.ashx agrega sobre TODOS los tickets del rango; `detalle`
  // viene topeado en TOPE_DETALLE. Mientras la unica dimension activa sea la
  // propia grafica (o no haya ninguna), su poblacion es el rango completo y
  // debe salir del servidor. Solo cuando otra dimension filtra hay que
  // recalcular sobre las filas cargadas.
  function usarAgregadoServidor(dim) {
    return dimensionesActivas(filtro).every(([d]) => d === dim);
  }

  function entradasServidor(dim, ordenCanonico) {
    const crudo = (datos && datos.distribucion && datos.distribucion[dim]) || [];
    const m = new Map();
    for (const x of crudo) {
      const k = txt(x.Valor) || SIN_VALOR[dim];
      const n = Number(x.Tickets) || 0;
      if (n <= 0) continue;
      m.set(k, (m.get(k) ?? 0) + n);
    }
    const ent = [...m.entries()];
    if (ordenCanonico) {
      const pos = v => { const i = ordenCanonico.indexOf(v); return i < 0 ? 999 : i; };
      ent.sort((a, b) => pos(a[0]) - pos(b[0]));
    } else {
      ent.sort((a, b) => b[1] - a[1]);
    }
    return ent;
  }

  // Rebanadas de una grafica de dimension: exactas si se pueden pedir al
  // servidor, recalculadas sobre lo cargado si no.
  function entradasDim(dim, ordenCanonico) {
    return usarAgregadoServidor(dim)
      ? entradasServidor(dim, ordenCanonico)
      : contarPor(filas(dim), VALOR_DIM[dim], ordenCanonico);
  }

  function alternarFiltro(dim, valor) {
    if (valor === null || valor === undefined) return;
    // Sin detalle no hay con que recalcular las demas graficas: filtrar dejaria
    // todo en cero y pareceria que no hay tickets: mejor no filtrar en falso.
    if (!detalleDisponible) return;
    filtro[dim] = (filtro[dim] === valor) ? null : valor;
    renderTodo('filtro');
  }

  // ---------------------------------------------------------- filtros al servidor
  // formatoFecha() y hoyISO() viven en el ambito global (arriba): los usan los
  // dos tableros, no solo este.

  // Rango con el que abre el tablero: del dia 1 del mes en curso a hoy. Vive
  // aparte porque lo usan DOS caminos que tienen que coincidir: el arranque
  // (init) y "Limpiar". Cuando "Limpiar" fijaba su propio rango (hoy a hoy),
  // dejaba la tendencia con un solo dia -vacia si hoy todavia no tiene
  // tickets-, que no es el estado con el que abre el tablero.
  function rangoPorDefecto() {
    const inicioMes = new Date();
    inicioMes.setDate(1);
    return { inicio: formatoFecha(inicioMes), fin: hoyISO() };
  }

  // Unico sitio donde se escriben las dos fechas por codigo: el arranque,
  // "Limpiar", los rangos rapidos y los SLOTs pasan por aqui.
  function escribirRango(r) {
    document.getElementById('f-inicio').value = r.inicio;
    document.getElementById('f-fin').value = r.fin;
  }

  function aplicarRangoRapido(tipo) {
    const hoy = new Date();
    let inicio, fin = new Date(hoy);
    if (tipo === '7d') { inicio = new Date(hoy); inicio.setDate(inicio.getDate() - 6); }
    else if (tipo === 'anio') inicio = new Date(hoy.getFullYear(), 0, 1);
    // "Mes" (solo Call Center) es el mes en curso, no los ultimos 30 dias: del
    // dia 1 del mes a hoy, igual que "Año" va del 1 de enero a hoy.
    else if (tipo === 'mes') inicio = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
    else return;   // rango desconocido: mejor no escribir fechas invalidas
    // El rango rapido manda sobre el SLOT: acaba de fijar un periodo distinto,
    // asi que dejar el SLOT en vigor contradiria lo que se acaba de pedir.
    desactivarSlots();
    escribirRango({ inicio: formatoFecha(inicio), fin: formatoFecha(fin) });
    cargarTodo();
  }

  function paramsFiltros() {
    const fi = document.getElementById('f-inicio').value;
    const ff = document.getElementById('f-fin').value;
    const grupos = seleccionados('f-grupos');
    const tecnicos = seleccionados('f-tecnicos');
    const p = new URLSearchParams();
    if (fi) p.set('fecha_inicio', fi);
    if (ff) p.set('fecha_fin', ff);
    if (grupos.length) p.set('grupos', grupos.join(','));
    // Los nombres de tecnico vienen como "Apellidos, Nombre": la coma es parte
    // del nombre, asi que la lista se separa con | y el SP la parte con | (ver
    // dbo.fn_Dash_SplitListPipe). Grupos sigue con coma: ninguno la contiene.
    if (tecnicos.length) p.set('tecnicos', tecnicos.join('|'));
    return p;
  }

  /* Parametros del Call Center: el MISMO rango de fechas que los tickets -es
     lo que permite comparar los dos lados de la atencion- mas su filtro
     propio de campanas.

     La campana se agrega AQUI y no en paramsFiltros() a proposito: asi
     llamadas.ashx es el unico handler que la recibe. Los de tickets no la
     leen, pero mandarsela igual dejaria una lista de parametros que no
     describe lo que cada peticion usa de verdad.

     Los filtros de Grupos y Tecnicos se quitan: una llamada no tiene grupo
     resolutor, y el handler tampoco los mira.

     Separador coma: a diferencia de los tecnicos ("Apellidos, Nombre"), el
     valor es el numero de cola y nunca contiene comas. */
  function paramsLlamadas() {
    const p = paramsFiltros();
    p.delete('grupos');
    p.delete('tecnicos');
    const campanas = seleccionados('f-campanas');
    if (campanas.length) p.set('campanas', campanas.join(','));
    return p;
  }

  // Mismo rango de fechas, pero sin el filtro de Tecnicos: es lo que alimenta
  // el ranking de personas con mas tickets cerrados.
  function paramsSoloGrupos() {
    const p = paramsFiltros();
    p.delete('tecnicos');
    return p;
  }

  // Ventana fija del ranking de personas: los ultimos 7 dias COMPLETOS, sin
  // contar hoy. Hoy va a medias (el dia sigue corriendo), asi que incluirlo
  // hunde el conteo de cerrados y el orden del ranking cambia segun la hora a
  // la que se abra el tablero.
  const DIAS_RANKING = 7;

  function rangoRanking() {
    // Con SLOT aplicado el ranking usa el periodo HISTORICO seleccionado, para
    // que el numero signifique lo mismo en la grafica y en la tabla: del
    // inicio del SLOT mas antiguo (N) al final del SLOT 1, que es hoy. Con
    // N = 2 son los SLOT 1 y 2, o sea 0-60d. El SLOT 0 no entra en la cuenta:
    // es el ancla del eje, no un periodo, y su dia ya esta dentro del SLOT 1.
    if (enModoSlot()) {
      return {
        inicio: slotRango(slotsAplicados).inicio,
        fin: slotRango(1).fin,
      };
    }
    const fin = new Date();
    fin.setDate(fin.getDate() - 1);          // ayer: ultimo dia completo
    const inicio = new Date(fin);
    inicio.setDate(inicio.getDate() - (DIAS_RANKING - 1));
    return { inicio: formatoFecha(inicio), fin: formatoFecha(fin) };
  }

  // El ranking NO sigue el rango de fechas del tablero: usa su propia ventana
  // (rangoRanking) y solo hereda el filtro de Grupos.
  function paramsRankingCerrados() {
    const p = paramsSoloGrupos();
    const r = rangoRanking();
    p.set('fecha_inicio', r.inicio);
    p.set('fecha_fin', r.fin);
    return p;
  }

  // ------------------------------------------------------------------- SLOT
  // El SLOT numera periodos historicos rodantes hacia atras, y el numero
  // crece cuanto mas viejo es el periodo. El 0 no es un periodo de 30 dias:
  // es el ancla del eje, AYER -el ultimo dia completo-.
  //
  //   SLOT 0 = ayer, un solo dia (ancla, no es un periodo)
  //   SLOT 1 = 0-30 dias atras
  //   SLOT 2 = 31-60 dias atras
  //   SLOT 3 = 61-90 dias atras
  //   SLOT k = 30(k-1)+1 .. 30k dias atras   (k >= 2)
  //
  // Los SLOTs historicos reparten el rango sin hueco ni solape ENTRE ELLOS:
  // el dia 30 es el ultimo del SLOT 1 y el 31 el primero del SLOT 2. El 1
  // mide 31 dias -de hoy al dia 30- y los demas 30.
  //
  // El SLOT 0 no participa de ese reparto y no le quita nada al SLOT 1: no es
  // un bucket, es la REFERENCIA con la que arranca la linea de tiempo, el
  // ultimo dia cerrado. Que su fecha caiga tambien dentro del SLOT 1 es
  // deliberado -es el borde donde empieza el periodo-, y no dibuja dos veces
  // el mismo dato: el SLOT 0 pinta el valor de ayer y el SLOT 1 el agregado
  // de sus 31 dias, que son dos observaciones distintas.
  //
  // El SLOT 0 es ademas la unica posicion que vale UN dia frente a los 30 de
  // las demas, asi que su valor es siempre mucho menor; el tooltip da el
  // rango de cada punto para que se lea por lo que es.
  //
  // El selector pide N periodos HISTORICOS: N = 1 es el SLOT 1, N = 3 son los
  // SLOT 1, 2 y 3. La grafica dibuja siempre N + 1 posiciones, porque a los N
  // SLOTs les precede el ancla. Su unico efecto sobre los datos es escribir
  // el rango de fechas.
  // A partir de aqui la vista diaria deja de ser legible y la tendencia pasa
  // a bloques de un mes. Es el mismo tope con el que estiloTendencia ya dejaba
  // de dibujar marcadores: por encima, la grafica ya no ensenaba una sola
  // observacion.
  const TOPE_DIARIO = 120;

  const DIAS_SLOT = 30;
  const MAX_SLOTS = 12;              // hasta 360 dias hacia atras
  // Preparado en el stepper vs. vigente en los datos que hay en pantalla. Son
  // distintos mientras el usuario mueve el numero y todavia no aplica.
  let slotsN = 0;                    // 0 = sin SLOT, manda el rango manual
  let slotsAplicados = 0;

  // Rango de calendario del SLOT k (k >= 1), con los dos extremos dentro. El
  // SLOT 1 termina hoy (dia 0) y cada SLOT empieza justo donde acaba el
  // anterior: el dia mas reciente del SLOT k es el 30(k-1)+1 y el mas viejo
  // el 30k. Los N SLOTs cubren por tanto los dias 0..30N, sin dejar ni
  // repetir uno.
  function slotRango(k) {
    const fin = new Date();
    fin.setDate(fin.getDate() - (k <= 1 ? 0 : (k - 1) * DIAS_SLOT + 1));
    const inicio = new Date();
    inicio.setDate(inicio.getDate() - k * DIAS_SLOT);
    return { inicio: formatoFecha(inicio), fin: formatoFecha(fin) };
  }

  // El ancla del eje -el SLOT 0-: AYER y solo ayer. Es el ultimo dia
  // COMPLETO, y por eso ancla aqui y no hoy: hoy va a medias -el dia sigue
  // corriendo-, asi que su valor es una fraccion del de un dia cerrado y el
  // primer punto de la grafica se leia como un cero pegado al eje. Es la
  // misma razon por la que el ranking lleva desde siempre su ventana hasta
  // ayer (ver rangoRanking).
  //
  // No agrega nada: es un dia suelto con su valor real. Lleva par inicio/fin
  // como los bloques para que el tooltip lo describa igual.
  function rangoAncla() {
    const ayer = new Date();
    ayer.setDate(ayer.getDate() - 1);
    const iso = formatoFecha(ayer);
    return { inicio: iso, fin: iso };
  }
  // Hay SLOT en vigor solo cuando el usuario aplico uno: el numero preparado en
  // el stepper no cuenta hasta que se pulsa "Aplicar filtros".
  function enModoSlot() {
    return slotsAplicados > 0;
  }

  // Dias completos entre una fecha aaaa-mm-dd y hoy: 0 es hoy, 1 es ayer. -1
  // si no es una fecha o si esta en el futuro. Se compara a mediodia para que
  // el cambio de horario de verano no corra un dia. La usan slotDeFecha, para
  // saber a que bloque va una fecha, y agruparPorSlot, para reconocer el dia
  // de hoy: duplicar esta aritmetica es justo como se acaban desincronizando.
  function diasAtras(iso) {
    const t = String(iso || '').slice(0, 10).split('-');
    if (t.length !== 3) return -1;
    const dia = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]), 12);
    const hoy = new Date();
    hoy.setHours(12, 0, 0, 0);
    const dias = Math.floor((hoy - dia) / 86400000);
    return dias < 0 ? -1 : dias;
  }

  // A que SLOT cae una fecha aaaa-mm-dd, contando los dias completos que la
  // separan de hoy. Es la inversa exacta de slotRango: el dia 30 todavia es
  // SLOT 1 (0-30d) y el 31 ya es SLOT 2 (31-60d), de ahi el techo en vez del
  // suelo. Los dias 0..30 caen todos en el 1 -ceil(0/30) seria 0, y el 0 no es
  // un bucket sino el ancla-, y a partir de ahi cada bloque de 30 sube un
  // numero. Una fecha invalida o futura sigue devolviendo -1.
  function slotDeFecha(iso) {
    const dias = diasAtras(iso);
    if (dias < 0) return -1;
    return Math.max(1, Math.ceil(dias / DIAS_SLOT));
  }

  /* Suma las series diarias por SLOT y antepone el ancla. Con varios SLOTs la
     grafica diaria se vuelve ilegible (8 SLOTs son ~240 puntos), asi que se
     muestra un valor por SLOT. No cambia el significado de nada: son las
     MISMAS series diarias, sumadas por bloque.

     El eje sale con N + 1 posiciones: el SLOT 0 y los SLOT 1..N, de reciente
     a antiguo, que es como el negocio numera los SLOTs.

     El SLOT 0 es AYER: el ancla del eje, el ultimo dia COMPLETO. Es una
     posicion REAL, no una banda vacia ni una marca dibujada: lleva los
     tickets de ese dia, los que ya venian en la serie diaria. Es lo que da un
     segundo punto con N = 1 -antes habia que partir el bloque en tramos para
     que la grafica ensenara una linea- sin inventar ni un dato: si ayer no
     hubo tickets, el punto vale cero porque ese es su valor.

     No ancla en hoy porque hoy va a medias: su valor no es comparable con el
     de un dia cerrado y el primer punto se leia como un cero pegado al eje.
     Es el mismo motivo por el que el ranking lleva desde siempre su ventana
     solo hasta ayer.

     Ese dia sigue contando ademas dentro del SLOT 1, que arranca en el dia 0.
     No es contarlo dos veces: el SLOT 0 dibuja el valor de UN dia y el SLOT 1
     el agregado de sus 31, dos observaciones distintas. La fecha compartida es
     el borde donde empieza el primer periodo, que es justo lo que el ancla
     senala. */
  function agruparPorSlot(fechas, series, n) {
    const cubos = new Map();          // numero de SLOT -> {suma por serie}
    const ancla = series.map(() => 0); // el SLOT 0: solo el dia de ayer
    fechas.forEach((f, i) => {
      const d = diasAtras(f);
      if (d === 1) series.forEach((serie, j) => { ancla[j] += Number(serie[i]) || 0; });
      const s = slotDeFecha(f);
      if (s < 1 || s > n) return;     // fuera del periodo pedido: no se cuenta
      if (!cubos.has(s)) cubos.set(s, series.map(() => 0));
      const acc = cubos.get(s);
      series.forEach((serie, j) => { acc[j] += Number(serie[i]) || 0; });
    });

    // La etiqueta de cada bloque es su numero REAL de SLOT, el mismo que
    // devuelve slotDeFecha y el mismo que acota slotRango, asi que el numero
    // del eje, el rango del tooltip y el filtro de fechas hablan siempre del
    // mismo periodo.
    const indices = [];
    for (let s = 1; s <= n; s++) indices.push(s);       // reciente -> viejo
    return {
      etiquetas: ['SLOT 0', ...indices.map(s => `SLOT ${s}`)],
      rangos: [rangoAncla(), ...indices.map(s => slotRango(s))],
      series: series.map((_, j) =>
        [ancla[j], ...indices.map(s => (cubos.get(s) || [])[j] || 0)]),
    };
  }

  /* Agrupa la serie diaria por mes de calendario. Es el gemelo de
     agruparPorSlot para el caso que no viene de SLOT -un rango largo escrito a
     mano o el boton "Año"-, y sale de como resuelve esto Experiencia: su
     grafica de evolucion NUNCA pinta observaciones crudas, siempre 10 bloques
     de SLOT o 12 meses de calendario (modoTiempo, renderEvol). Un eje con una
     docena de categorias reparte sus puntos por todo el ancho; uno con 250
     dias los amontona y por eso la vista diaria larga ya se dibujaba sin un
     solo marcador.

     No cambia lo que mide la grafica: son las MISMAS series diarias, sumadas
     por mes. El tooltip sigue dando el rango exacto de dias que hay detras de
     cada punto, y los KPIs, la tabla y el resto del tablero no se enteran. */
  function agruparPorMes(fechas, series) {
    const cubos = new Map();          // 'aaaa-mm' -> { dias: [], sumas: [] }
    fechas.forEach((f, i) => {
      const p = partesDia(f);
      if (!p) return;                 // etiqueta que no es un dia: se ignora
      const clave = `${p.ano}-${String(p.mes).padStart(2, '0')}`;
      if (!cubos.has(clave)) cubos.set(clave, { p, dias: [], sumas: series.map(() => 0) });
      const acc = cubos.get(clave);
      acc.dias.push(String(f).slice(0, 10));
      series.forEach((serie, j) => { acc.sumas[j] += Number(serie[i]) || 0; });
    });

    const claves = [...cubos.keys()].sort();
    const anos = new Set(claves.map(c => c.slice(0, 4)));
    return {
      // El año solo se escribe si el rango cruza mas de uno: dos "sep"
      // distintos no pueden leerse igual.
      etiquetas: claves.map(c => {
        const { p } = cubos.get(c);
        return anos.size > 1 ? `${mesCorto(p.mes)} ${p.ano.slice(2)}` : mesCorto(p.mes);
      }),
      // Primer y ultimo dia CON DATOS del mes, no el 1 y el 31: el bloque
      // describe lo que se sumo, no el calendario.
      rangos: claves.map(c => {
        const dias = cubos.get(c).dias.slice().sort();
        return { inicio: dias[0], fin: dias[dias.length - 1] };
      }),
      series: series.map((_, j) => claves.map(c => cubos.get(c).sumas[j])),
    };
  }

  const MESES_CORTOS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun',
                        'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const ETIQUETA_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

  // Parte una etiqueta diaria "2026-09-03". Devuelve null si la etiqueta no es
  // un dia -las de SLOT ("SLOT 3") no lo son, y se dejan intactas en todas las
  // funciones de abajo-.
  function partesDia(etiqueta) {
    const m = ETIQUETA_DIA.exec(String(etiqueta ?? ''));
    return m ? { ano: m[1], mes: Number(m[2]), dia: m[3] } : null;
  }

  function mesCorto(n) { return MESES_CORTOS[n - 1] || ''; }

  // Titulo del tooltip en vista diaria: "03 sep 2026". El eje puede estar
  // mostrando solo el mes, pero al hacer hover el dia exacto sigue apareciendo.
  function fechaLargaTendencia(etiqueta) {
    const p = partesDia(etiqueta);
    return p ? `${p.dia} ${mesCorto(p.mes)} ${p.ano}` : String(etiqueta ?? '');
  }

  /* Presentacion adaptativa de la tendencia. NO toca los datos: las series y
     las etiquetas internas siguen siendo diarias y completas -el hover sigue
     alcanzando cada observacion-; lo unico que cambia es cuantos marcadores y
     cuantas etiquetas del eje X se DIBUJAN. Con un año son ~365 observaciones:
     pintar 1095 puntos y 365 fechas es justo lo que hacia ilegible esa vista.

     `textos` viene ya resuelto -una entrada por indice, '' donde no va etiqueta-
     para que el callback del tick solo tenga que indexar.

     `agrupado` avisa de que las etiquetas son bloques (SLOT o mes) y no dias
     sueltos. */
  function estiloTendencia(etiquetas, agrupado) {
    const n = etiquetas.length;
    const textos = new Array(n).fill('');

    if (n > 120) {
      // Rango largo: una etiqueta por mes y solo el mes, que es lo que deja el
      // eje limpio (~12-13 etiquetas en un año). Si hay mas de un año en
      // pantalla se añade el año: dos "sep" distintos no pueden leerse igual.
      const anos = new Set();
      etiquetas.forEach(e => { const p = partesDia(e); if (p) anos.add(p.ano); });
      const conAno = anos.size > 1;
      // Primer indice de cada mes. Mas alla de dos años los meses tambien se
      // amontonan, asi que se etiqueta uno de cada `paso` para no pasar de ~13.
      const iniciosMes = [];
      let mesPrevio = null;
      etiquetas.forEach((e, i) => {
        const p = partesDia(e);
        if (!p) { textos[i] = String(e ?? ''); return; }
        const clave = `${p.ano}-${p.mes}`;
        if (clave === mesPrevio) return;
        mesPrevio = clave;
        iniciosMes.push({ i, p });
      });
      const paso = Math.ceil(iniciosMes.length / 13) || 1;
      iniciosMes.forEach(({ i, p }, k) => {
        if (k % paso !== 0) return;
        textos[i] = conAno ? `${mesCorto(p.mes)} ${p.ano.slice(2)}` : mesCorto(p.mes);
      });
      return { pointRadius: 0, pointHoverRadius: 5, centrado: false, textos };
    }

    // Rangos corto y medio: fecha con dia, una de cada `paso` para que no se
    // solapen. Hasta 15 observaciones se dibujan todas y con el punto de
    // siempre: la vista de 12 SLOTs queda exactamente igual que antes.
    const paso = n <= 15 ? 1 : Math.ceil(n / 12);
    etiquetas.forEach((e, i) => {
      if (i % paso !== 0) return;
      const p = partesDia(e);
      textos[i] = p ? `${p.dia} ${mesCorto(p.mes)}` : String(e ?? '');
    });
    // Una sola observacion (rango de un dia) no dibuja NINGUN segmento de linea
    // ni area: la grafica se reduce a tres puntos del tamaño de siempre en
    // mitad de un lienzo vacio, que es justo lo que se lee como "no se pinto
    // nada". El punto se agranda para que ese estado se vea intencional. No se
    // inventa un segundo punto ni se duplica el dato: sigue siendo una
    // observacion, solo que visible. Mismo recurso que usa Experiencia para
    // destacar un punto (pointRadii en renderEvol).
    // `centrado` = escala de categorias con offset. Con UNA sola observacion la
    // escala sin offset pega el punto contra el eje Y, en el pixel 0: quedan
    // tres puntitos en la esquina y el 99% del lienzo vacio, que es
    // exactamente el sintoma de "la grafica no se pinto". Con offset el punto
    // cae en el centro de su banda, o sea en medio del lienzo. Es una opcion
    // de la escala, no un dato: la serie sigue teniendo una sola observacion.
    if (n === 1) return { pointRadius: 5, pointHoverRadius: 8, centrado: true, textos };

    /* Bandas centradas. La escala de categorias sin offset ancla la PRIMERA
       observacion en el borde izquierdo del area de dibujo y la ULTIMA en el
       derecho. Con muchas observaciones no se nota; con dos -los dos bloques
       de "Ultimos 2 SLOTs"- deja un punto pegado a cada extremo, el ultimo
       medio comido por el borde de la tarjeta y todo el ancho vacio en medio.
       Con offset cada punto cae en el centro de su banda, asi que dos puntos
       se reparten el ancho por igual, igual que los 10 bloques de la grafica
       de Experiencia.

       Se centra siempre que las etiquetas sean bloques -un bloque ocupa un
       tramo de tiempo, no un instante, y su sitio natural es el centro de su
       banda- y tambien cuando hay muy pocas observaciones diarias, que es
       donde el anclaje a los bordes se lee como un error de dibujo. */
    const centrado = !!agrupado || n <= 4;

    return {
      pointRadius: n <= 15 ? 3 : (n <= 60 ? 2 : 0),
      pointHoverRadius: n <= 15 ? 6 : 5,
      centrado,
      textos,
    };
  }

  // Resumen del periodo que pide el numero: "SLOT 1-3 · 0-90d". Nombra los
  // SLOTs HISTORICOS que se van a ver -siempre desde el 1- en vez de
  // contarlos, para que el texto se lea igual que el eje, y da su ventana con
  // la misma notacion de antiguedad con la que el negocio define un SLOT.
  // El SLOT 0 no se nombra: es el ancla del eje, no un periodo, y su dia ya
  // esta contado dentro del SLOT 1.
  function resumenSlots(n) {
    const cuales = n === 1 ? 'SLOT 1' : `SLOT 1-${n}`;
    return `${cuales} · 0-${n * DIAS_SLOT}d`;
  }

  // Pinta el stepper. No recarga nada: se llama tanto desde renderTodo como
  // desde los botones - / +, que solo mueven el numero.
  function renderSlotStepper() {
    // El 0 es un estado propio -SLOT apagado, manda el rango manual-, asi que
    // se pinta tal cual en vez de ensenar un 1 que nadie ha pedido.
    document.getElementById('slot-n').textContent = String(slotsN);
    document.getElementById('slot-menos').disabled = slotsN <= 0;
    document.getElementById('slot-mas').disabled = slotsN >= MAX_SLOTS;

    // Sin aplicar, el numero es una intencion: el aviso evita leerlo como si ya
    // estuviera en la grafica.
    const pendiente = slotsN !== slotsAplicados;
    const sum = document.getElementById('slot-sum');
    sum.textContent = slotsN === 0
      ? 'Sin SLOT · rango manual'
      : resumenSlots(slotsN) + (pendiente ? ' · sin aplicar' : '');

    // El acento marca lo que de verdad se esta viendo, no lo preparado.
    const vigente = enModoSlot() && !pendiente;
    document.getElementById('slot-step').classList.toggle('sel', vigente);
    sum.classList.toggle('sel', vigente);

    // Con 0 el control se ve apagado: no hay periodo preparado ni aplicado.
    document.getElementById('slot-step').classList.toggle('off', slotsN === 0);
    sum.classList.toggle('off', slotsN === 0);
  }

  // Pone en vigor el SLOT escribiendo su rango en las fechas. No recarga por su
  // cuenta: quien lo llama encadena la carga. Asi los KPIs, la tendencia y el
  // ranking hablan siempre del mismo periodo que muestra el control.
  function aplicarSlots() {
    slotsAplicados = slotsN;
    if (slotsN > 0) {
      escribirRango({ inicio: slotRango(slotsN).inicio, fin: slotRango(1).fin });
    }
    // Repintar aqui y no solo desde renderTodo: si la carga falla, el control
    // no puede quedarse anunciando el periodo anterior.
    renderSlotStepper();
  }

  // Vuelve al rango manual: lo usan los rangos rapidos y "Limpiar", que mandan
  // sobre el SLOT porque acaban de fijar un periodo distinto a mano.
  function desactivarSlots() {
    slotsN = 0;
    slotsAplicados = 0;
    renderSlotStepper();
  }

  /* ------------------------------------------ Acotado al Call Center
     La barra de filtros es UNA sola y viaja entre las pestañas "SLA y
     productividad" y "Call Center" (ver adoptarControlesSla). Ahi no todos
     los grupos vienen a cuento: quien contesta telefono esta en Service Desk
     o End User, y fuera de esos dos no hay llamadas ni tecnicos que cruzar.
     El backend ya lo sabia -carga_combinada.ashx manda ese par como valor por
     omision de @Grupos-, asi que catalogos.ashx devuelve ahora, junto a las
     listas completas de SLA, el subconjunto del Call Center leido de la misma
     vista de donde sale todo lo demas: la relacion tecnico -> grupo es la que
     ya esta en los datos, aqui no hay ninguna lista de nombres a mano.

     No se esconden <option> con CSS: se cambia el juego de <option> del
     <select>, que es la fuente de la verdad de la que leen paramsFiltros() y
     el desplegable propio -su MutationObserver de childList repinta el panel
     solo-. Lo que estuviera elegido en SLA se guarda al entrar y se devuelve
     entero al salir, para que la otra pestaña no pierda sus filtros por haber
     pasado por aqui. */
  let catalogos = { grupos: [], tecnicos: [], gruposCall: [], tecnicosCall: [] };
  let enCallCenter = false;
  let seleccionSla = null;   // lo elegido en SLA mientras la barra esta prestada

  const opcionesHtml = v => v.map(
    x => `<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join('');

  /* Reescribe las <option> de un <select> y le devuelve la seleccion que se
     le pida, quedandose solo con los valores que sigan existiendo. Responde
     si la seleccion EFECTIVA cambio, que es lo unico que obliga a recargar. */
  function ponerOpciones(id, valores, deseada) {
    const sel = document.getElementById(id);
    if (!sel) return false;
    const antes = JSON.stringify(seleccionados(id));
    sel.innerHTML = opcionesHtml(valores ?? []);
    const quiero = new Set(deseada ?? []);
    for (const op of sel.options) op.selected = quiero.has(op.value);
    return JSON.stringify(seleccionados(id)) !== antes;
  }

  function aplicarCatalogos() {
    const g = enCallCenter ? catalogos.gruposCall : catalogos.grupos;
    const t = enCallCenter ? catalogos.tecnicosCall : catalogos.tecnicos;
    const quiero = seleccionSla ?? {
      grupos: seleccionados('f-grupos'), tecnicos: seleccionados('f-tecnicos') };
    // Los dos se evaluan SIEMPRE: con || el segundo se saltaria en cuanto el
    // primero cambiara, y el <select> de tecnicos se quedaria con el catalogo
    // de la otra pestaña.
    const cambioG = ponerOpciones('f-grupos', g, quiero.grupos);
    const cambioT = ponerOpciones('f-tecnicos', t, quiero.tecnicos);
    return cambioG || cambioT;
  }

  /* La llama adoptarControlesSla() al mover la barra de pestaña. Si el juego
     de filtros que queda puesto no es el que trajo los datos que hay en
     pantalla, se pide una carga: si no, se estaria viendo una barra que dice
     una cosa y unas graficas que dicen otra. */
  function modoCallCenter(esCall) {
    if (esCall === enCallCenter) return;
    // Al entrar se guarda lo de SLA; al salir se devuelve y se olvida.
    seleccionSla = esCall
      ? { grupos: seleccionados('f-grupos'), tecnicos: seleccionados('f-tecnicos') }
      : seleccionSla;
    enCallCenter = esCall;
    const cambio = aplicarCatalogos();
    if (!esCall) seleccionSla = null;
    if (cambio) programarCarga();
  }

  async function cargarCatalogos() {
    const cat = await obtenerJSON('catalogos.ashx');
    catalogos = {
      grupos: cat.grupos ?? [],
      tecnicos: cat.tecnicos ?? [],
      // Servidor viejo -o catalogos.ashx sin actualizar-: sin el subconjunto
      // se cae a las listas completas. Es la conducta de antes, no una
      // pestaña rota.
      gruposCall: cat.gruposCall ?? cat.grupos ?? [],
      tecnicosCall: cat.tecnicosCall ?? cat.tecnicos ?? [],
    };
    // El catalogo llega despues del primer pintado: si para entonces la barra
    // ya esta en el Call Center, tiene que nacer acotada.
    aplicarCatalogos();
  }

  // ---------------------------------------------------------------------- KPIs
  /* Semaforo de reabiertos: al reves que el de SLA -aqui menos es mejor-, y
     con cortes de 5% y 10% porque el promedio global ronda el 4%: con los
     umbrales del SLA todo saldria verde siempre. */
  const SEM_REABIERTOS = pct =>
    (pct === null || pct === undefined || !isFinite(Number(pct))) ? ''
      : (Number(pct) <= 5 ? 'sv' : (Number(pct) <= 10 ? 'sa' : 'sr'));

  /* Pie de la tarjeta de "Creados": el balance del periodo en una frase. Si
     entraron mas de los que se resolvieron, el backlog crecio.

     Los rechazados no son resueltos -rechazar no es resolver-, pero si
     salieron del backlog, asi que parte del hueco entre las dos cifras es eso
     y no trabajo pendiente. Se dicen aparte y NO se suman a resueltos: los
     creados van por fecha de registro y los otros dos por fecha de solucion,
     asi que creados = resueltos + rechazados no tiene por que cuadrar. */
  function balanceTexto(creados, resueltos, rechazados) {
    const d = resueltos - creados;
    const nota = rechazados ? ` · ${FMT(rechazados)} rechazados aparte` : '';
    if (!creados && !resueltos) return `sin movimiento en el periodo${nota}`;
    if (d === 0) return `entraron y salieron los mismos${nota}`;
    return (d > 0
      ? `se resolvieron ${FMT(d)} mas de los que entraron`
      : `entraron ${FMT(-d)} mas de los que se resolvieron`) + nota;
  }

  /* Minutos -> '45 min' o '3h 20m'. La primera respuesta se mide casi toda
     en minutos, pero la cola se va a horas y '212 min' no se lee de un
     vistazo. */
  function minutosLegibles(v) {
    if (v === null || v === undefined) return 'N/D';
    const m = Math.round(Number(v));
    if (!isFinite(m)) return 'N/D';
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60), r = m % 60;
    return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
  }

  // Cuenta que no es persona (dbo.CatCuentaNoPersona): el servidor la marca
  // con EsPersona = 0 en el detalle. Sin el campo -backend anterior- cuenta
  // como persona.
  const noEsPersona = r => r.EsPersona === false || r.EsPersona === 0;

  // Mediana interpolada entre los dos centrales cuando el conteo es par, que
  // es lo mismo que hace PERCENTILE_CONT en kpis.ashx.
  function mediana(valores) {
    const o = valores.map(Number).filter(v => isFinite(v)).sort((a, b) => a - b);
    if (!o.length) return null;
    const m = o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
    return Math.round(100 * m) / 100;
  }

  const esReabierto = r => r.EsReabierto === true || r.EsReabierto === 1 || Number(r.IntentosSolucion) > 1;

  function renderKpis() {
    const cont = document.getElementById('kpis');
    const k = datos.kpis || {};
    /* El rango mide lo RESUELTO (fecha de solucion). TicketsResueltos es el
       campo nuevo; TicketsTotales vale lo mismo y queda de respaldo para un
       backend anterior. */
    const resueltos = k.TicketsResueltos ?? k.TicketsTotales ?? 0;

    let tarjetas;
    if (!hayFiltro()) {
      // Sin cross-filter los KPIs salen del servidor: son exactos sobre todo el rango.
      const cumpl = k.CumplimientoSlaPct ?? null;
      const evaluables = k.TicketsSlaEvaluable ?? 0;
      const vencidos = k.TicketsSlaVencidos ?? 0;
      const reabPct = k.ReabiertosPct ?? null;
      tarjetas = [
        { l: 'Resueltos', v: FMT(resueltos),
          f: k.TicketsAbiertos ? `${FMT(k.TicketsAbiertos)} aun esperan el cierre` : 'lo que el equipo despacho' },
        { l: 'Creados', v: k.TicketsCreados != null ? FMT(k.TicketsCreados) : 'N/D',
          f: k.TicketsCreados != null ? balanceTexto(k.TicketsCreados, resueltos, k.TicketsRechazados ?? 0) : 'por fecha de registro' },
        /* Primera respuesta: sale del texto 'Nh NNm' de Proactivanet, no del
           campo de horas enteras, que vale 0 en 7 de cada 10 tickets. Es otra
           metrica que las horas de resolucion. */
        { l: '1a respuesta (mediana)', v: minutosLegibles(k.MinutosPrimeraRespuestaMediana),
          f: k.MinutosPrimeraRespuestaP90 != null ? `p90 ${minutosLegibles(k.MinutosPrimeraRespuestaP90)}` : 'sin dato de primera respuesta' },
        { l: 'Cumplimiento SLA', v: cumpl !== null ? `${cumpl}%` : 'N/D',
          f: evaluables ? `${FMT(k.TicketsDentroSla ?? 0)} de ${FMT(evaluables)} evaluables` : 'sin SLA evaluable',
          s: cumpl !== null ? SEM(cumpl) : '' },
        { l: 'Vencidos SLA', v: FMT(vencidos),
          f: `${FMT(k.TicketsAltaPrioridad ?? 0)} de prioridad alta o critica`, s: vencidos > 0 ? 'sr' : 'sv' },
        /* Mediana y no promedio: el tiempo de resolucion tiene cola larga y
           el promedio lo deciden unos cuantos tickets de semanas. El promedio
           sigue en el pie para quien lo cuadre contra un reporte viejo. */
        { l: 'Horas resolucion (mediana)', v: k.HorasResolucionMediana ?? 'N/D',
          f: k.HorasResolucionPromedio != null ? `promedio ${k.HorasResolucionPromedio} h` : 'de registro a solucion' },
        { l: 'Horas resolucion (p90)', v: k.HorasResolucionP90 ?? 'N/D',
          f: '9 de cada 10 tardaron menos' },
        { l: 'Reabiertos', v: reabPct !== null ? `${reabPct}%` : 'N/D',
          f: `${FMT(k.TicketsReabiertos ?? 0)} volvieron despues de darse por resueltos`,
          s: SEM_REABIERTOS(reabPct) },
        /* Lo que resolvieron las cuentas que NO son personas
           (dbo.CatCuentaNoPersona). Se ensena para que sacarlas del ranking
           no las esconda. El porcentaje es sobre Resueltos, que YA las
           incluye: la exclusion solo toca lo que habla de personas. */
        { l: 'Automatizado', v: k.TicketsAutomatizados != null ? FMT(k.TicketsAutomatizados) : 'N/D',
          f: k.TicketsAutomatizados != null ? `${PCT(k.TicketsAutomatizados, resueltos)} de lo resuelto · fuera del ranking` : 'cuentas que no son personas' },
        { l: 'Tecnicos activos', v: FMT(k.TecnicosActivos ?? 0), f: `${FMT(k.GruposActivos ?? 0)} grupos · solo personas` },
        { l: 'Reasignaciones promedio', v: k.ReasignacionesPromedio ?? 'N/D', f: 'cambios de grupo por ticket' },
      ];
    } else {
      // Con cross-filter se recalculan sobre las filas cargadas. El pie lo dice
      // explicitamente para que nadie los confunda con el total del rango.
      // "Creados" y p90 no se recalculan: el detalle solo trae lo resuelto y
      // viene topeado, asi que cualquier cifra seria inventada.
      const f = filas(null);
      const n = f.length;
      const cargadas = (datos.detalle || []).length;
      const vencidos = f.filter(r => r.SlaVencido === true || r.SlaVencido === 1).length;
      const dentro = f.filter(r => r.DentroSla === true || r.DentroSla === 1).length;
      const reabiertos = f.filter(esReabierto).length;
      const evaluables = vencidos + dentro;
      const cumpl = evaluables > 0 ? Math.round(1000 * dentro / evaluables) / 10 : null;
      const horas = f.map(r => r.HorasResolucion).filter(h => h !== null && h !== undefined);
      const promedio = horas.length ? Math.round(100 * horas.reduce((a, b) => a + Number(b), 0) / horas.length) / 100 : null;
      const med = mediana(horas);
      // Misma mediana interpolada, sobre los tickets filtrados con dato.
      const respuestas = f.map(r => r.MinutosPrimeraRespuesta).filter(x => x !== null && x !== undefined);
      const medRespuesta = mediana(respuestas);
      const reabPct = n ? Math.round(1000 * reabiertos / n) / 10 : null;
      const deN = `filtrado: ${FMT(n)} de ${FMT(cargadas)} cargados`;

      tarjetas = [
        { l: 'Resueltos (filtrado)', v: FMT(n), f: deN },
        { l: 'Cumplimiento SLA', v: cumpl !== null ? `${cumpl}%` : 'N/D',
          f: evaluables ? `${FMT(dentro)} de ${FMT(evaluables)} evaluables` : 'sin SLA evaluable',
          s: cumpl !== null ? SEM(cumpl) : '' },
        { l: 'Vencidos SLA', v: FMT(vencidos), f: `${PCT(vencidos, n)} de lo filtrado`, s: vencidos > 0 ? 'sr' : 'sv' },
        { l: 'Horas resolucion (mediana)', v: med ?? 'N/D',
          f: `${FMT(horas.length)} tickets resueltos${promedio !== null ? ` · promedio ${promedio} h` : ''}` },
        { l: '1a respuesta (mediana)', v: minutosLegibles(medRespuesta), f: `${FMT(respuestas.length)} con dato` },
        { l: 'Reabiertos', v: reabPct !== null ? `${reabPct}%` : 'N/D',
          f: `${FMT(reabiertos)} de lo filtrado`, s: SEM_REABIERTOS(reabPct) },
        // Solo personas, igual que "Tecnicos activos" sin filtro.
        { l: 'Tecnicos', v: FMT(new Set(f.filter(r => !noEsPersona(r)).map(r => r.Tecnico).filter(Boolean)).size), f: 'en lo filtrado · solo personas' },
        { l: 'Grupos', v: FMT(new Set(f.map(r => r.Grupo).filter(Boolean)).size), f: 'en lo filtrado' },
      ];
    }

    cont.innerHTML = htmlTarjetasKpi(tarjetas);
  }

  // -------------------------------------------------------------------- graficas
  function destruir(id) { if (graficos[id]) { graficos[id].destroy(); delete graficos[id]; } }

  const EJE_CONTEO = { beginAtZero: true, ticks: { precision: 0, callback: v => FMT(v) } };

  function renderTendencia() {
    const hint = document.getElementById('hint-tendencia');
    /* `cerrados` es la serie de RESUELTOS (por fecha de solucion); conserva el
       nombre para no tocar el resto del bloque. dentro/evaluables son el
       numerador y el denominador del cumplimiento: viajan por aqui, y no en
       su propia funcion, para que "Cumplimiento de SLA en el tiempo" comparta
       EXACTAMENTE este eje -misma agrupacion por dia, mes o SLOT-. */
    // reabiertos es el numerador de "Reabiertos en el tiempo" (el
    // denominador son los resueltos): viaja por aqui por lo mismo.
    let etiquetas, creados, cerrados, vencidos, dentro, evaluables, reabiertos;

    if (!hayFiltro()) {
      // Serie exacta del servidor sobre todo el rango: creados por fecha de
      // registro, resueltos y SLA por fecha de solucion.
      const f = datos.tendencia || [];
      // El handler serializa la fecha como "aaaa-mm-ddT00:00:00" (ver
      // DashboardQueries.cs). La hora siempre es cero y solo servia para
      // ensuciar el eje, asi que la etiqueta interna queda en el dia exacto,
      // igual que en la rama filtrada de abajo.
      etiquetas = f.map(x => String(x.Fecha ?? '').slice(0, 10));
      creados = f.map(x => x.TicketsCreados);
      cerrados = f.map(x => x.TicketsResueltos ?? x.TicketsCerrados);
      vencidos = f.map(x => x.TicketsSlaVencidos);
      dentro = f.map(x => x.TicketsDentroSla ?? 0);
      evaluables = f.map(x => x.TicketsSlaEvaluable ?? 0);
      reabiertos = f.map(x => x.TicketsReabiertos ?? 0);
      hint.textContent = 'creados (por registro) vs resueltos (por solucion)';
    } else {
      /* Recalculada sobre las filas filtradas, agrupando por dia de SOLUCION,
         igual que el servidor. "Creados" no se puede recalcular -el detalle
         solo trae lo resuelto en el rango-, asi que se queda en cero mientras
         haya un filtro por clic, y el pie lo dice. */
      const f = filas(null);
      const porDia = new Map();
      for (const r of f) {
        const d = String(r.FechaFirmaSolucion ?? r.FechaRegistro ?? '').slice(0, 10);
        if (!d) continue;
        if (!porDia.has(d)) porDia.set(d, { res: 0, ven: 0, den: 0, num: 0, reab: 0 });
        const a = porDia.get(d);
        const ven = r.SlaVencido === true || r.SlaVencido === 1;
        const den = r.DentroSla === true || r.DentroSla === 1;
        a.res++;
        if (ven) a.ven++;
        // Evaluable = tiene veredicto: el detalle no trae SlaEvaluable, pero
        // un ticket con veredicto es exactamente eso.
        if (ven || den) a.den++;
        if (den) a.num++;
        if (esReabierto(r)) a.reab++;
      }
      const dias = [...porDia.keys()].sort();
      etiquetas = dias;
      creados = dias.map(() => 0);
      cerrados = dias.map(d => porDia.get(d).res);
      vencidos = dias.map(d => porDia.get(d).ven);
      dentro = dias.map(d => porDia.get(d).num);
      evaluables = dias.map(d => porDia.get(d).den);
      reabiertos = dias.map(d => porDia.get(d).reab);
      hint.textContent = 'resueltos, recalculado sobre lo filtrado (creados no aplica)';
    }

    /* Granularidad del eje. Es lo unico que decide este bloque: las series de
       arriba no se tocan, solo se suman por bloque.

       En modo SLOT se agrupa por SLOT, un punto por bloque, con HOY delante
       como origen. Ese origen es tambien lo que hace legible el caso de UN
       SOLO SLOT: dos posiciones dibujan una linea, mientras que un bloque
       suelto era un punto en mitad del lienzo. Fuera del modo SLOT, un rango
       largo -"Año" son ~250 dias- se agrupa por mes de calendario, en vez de
       pintar un punto por dia: es el mismo criterio de Experiencia, cuya
       evolucion siempre trabaja con una docena de bloques (SLOT o mes). Por
       debajo del tope la vista diaria se queda exactamente como estaba. */
    let rangosBucket = null;
    if (enModoSlot()) {
      const g = agruparPorSlot(etiquetas, [creados, cerrados, vencidos, dentro, evaluables, reabiertos], slotsAplicados);
      etiquetas = g.etiquetas;
      rangosBucket = g.rangos;
      [creados, cerrados, vencidos, dentro, evaluables, reabiertos] = g.series;
      hint.textContent = `${resumenSlots(slotsAplicados)} · agrupado por SLOT`;
    } else if (etiquetas.length > TOPE_DIARIO) {
      const g = agruparPorMes(etiquetas, [creados, cerrados, vencidos, dentro, evaluables, reabiertos]);
      // Un solo mes agrupado seria un unico punto en lugar de sus dias: el
      // agrupado solo compensa si hay varios bloques que comparar.
      if (g.etiquetas.length > 1) {
        etiquetas = g.etiquetas;
        rangosBucket = g.rangos;
        [creados, cerrados, vencidos, dentro, evaluables, reabiertos] = g.series;
        hint.textContent += ' · agrupado por mes';
      }
    }

    // El tooltip lee este valor a traves del closure, no de una copia dentro
    // de la config: asi la grafica se puede actualizar en vez de reconstruirse
    // cuando se pasa de vista diaria a agrupada por SLOT.
    rangosBucketVigente = rangosBucket;

    // Cuantas observaciones llegaron. Es el dato que distingue "el endpoint no
    // trajo nada" de "trajo un solo dia y se ve poco", que desde el navegador
    // son el mismo sintoma: una grafica que parece vacia.
    const observaciones = etiquetas.length;
    hint.textContent += ` · ${observaciones} ${observaciones === 1 ? 'observacion' : 'observaciones'}`;

    if (!etiquetas.length) {
      destruir('tendencia');
      // La de cumplimiento comparte este eje: sin observaciones pinta tambien
      // su propio vacio en vez de quedarse con el dibujo del rango anterior.
      renderSlaTiempo([], [], []);
      renderReabiertosTiempo([], [], []);
      // Con inicio == fin el mensaje generico ("el rango de fechas") no dice
      // nada: el rango ES un dia, y lo util es saber CUAL y que la consulta si
      // respondio. La fecha sale de los inputs, no de los datos -que no hay-.
      const ini = document.getElementById('f-inicio').value;
      const fin = document.getElementById('f-fin').value;
      const unDia = ini && ini === fin;
      return renderEmptyChart('chart-tendencia', hayFiltro()
        ? 'Ningun ticket resuelto pasa los filtros activos.'
        : unDia
          ? `Sin tickets creados ni resueltos el ${fechaLargaTendencia(ini)}. La consulta respondio, pero ese dia no tiene movimiento todavia.`
          : 'Sin tickets creados ni resueltos en el rango de fechas.');
    }

    // Igual que rangosBucketVigente: se reasigna el objeto que leen los callbacks
    // en vez de cambiar la config, para no tener que reconstruir la grafica al
    // pasar de vista diaria larga a corta o a SLOTs.
    estiloTendVigente = estiloTendencia(etiquetas, !!rangosBucket);
    // El eje de SLOTs arranca pegado al eje Y. estiloTendencia centra las
    // bandas de cualquier eje agrupado -un bloque ocupa un tramo de tiempo y
    // su sitio natural es el centro de su banda-, pero centrar reserva media
    // banda libre en cada extremo, y con pocas posiciones esa media banda es
    // una franja vacia enorme delante del SLOT 0: se leia como si la grafica
    // empezara en un punto que no esta. Aqui el primer punto ES el ancla, y
    // tiene que verse como el principio de la serie. El agrupado por mes se
    // queda centrado, que es como estaba.
    if (enModoSlot()) estiloTendVigente.centrado = false;
    const estilo = estiloTendVigente;

    // Con el eje ya resuelto: las dos graficas comparten etiquetas, rangos de
    // bloque y estilo por construccion, no por coincidencia.
    renderSlaTiempo(etiquetas, dentro, evaluables);
    renderReabiertosTiempo(etiquetas, reabiertos, cerrados);

    const serie = (label, data, color, rellenar) => ({
      label, data, borderColor: color,
      backgroundColor: rellenar ? 'rgba(37,99,235,.12)' : color,
      fill: !!rellenar, tension: .3, borderWidth: 2,
      pointRadius: estilo.pointRadius, pointHoverRadius: estilo.pointHoverRadius,
    });

    dibujarGrafico(graficos, 'tendencia', 'chart-tendencia',
      () => ({
        type: 'line',
        data: {
          labels: etiquetas,
          datasets: [
            serie('Creados', creados, AZUL, true),
            serie('Resueltos', cerrados, VERDE_S),
            serie('Vencidos SLA', vencidos, ROJO),
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } },
            // Agrupada en bloques -SLOT o mes- la etiqueta sola no dice de
            // que fechas habla: el rango del bloque va en el titulo del
            // tooltip. Sin agrupar, el titulo es la etiqueta de siempre.
            tooltip: {
              callbacks: {
                title: (items) => {
                  const r = rangosBucketVigente && rangosBucketVigente[items[0].dataIndex];
                  if (r) return `${items[0].label} · ${r.inicio} → ${r.fin}`;
                  // El eje puede estar mostrando solo el mes: el titulo lleva
                  // siempre el dia completo de la observacion bajo el cursor.
                  return fechaLargaTendencia(items[0].label);
                }
              }
            }
          },
          scales: {
            // autoSkip elegiria indices arbitrarios ("17 ene", "9 feb"), no
            // inicios de mes: la densidad se decide en estiloTendencia() y aqui
            // solo se lee. Los indices sin etiqueta devuelven '' -el punto sigue
            // en la escala, asi que el hover diario no se pierde-.
            x: {
              // Bandas centradas cuando el eje es de bloques o trae muy pocas
              // observaciones (ver estiloTendencia). En la vista diaria larga
              // sigue sin offset, que es como estaba.
              offset: estilo.centrado,
              ticks: {
                autoSkip: false, maxRotation: 0, minRotation: 0,
                callback: (_v, i) => estiloTendVigente.textos[i] ?? '',
              }
            },
            y: EJE_CONTEO
          }
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        const series = [creados, cerrados, vencidos];
        gr.data.datasets.forEach((ds, i) => {
          ds.data = series[i];
          // El estilo de punto depende de cuantas observaciones hay, asi que
          // cambia con el rango: se reescribe sobre la instancia viva en vez de
          // reconstruirla.
          ds.pointRadius = estilo.pointRadius;
          ds.pointHoverRadius = estilo.pointHoverRadius;
        });
        // `offset` es opcion de escala, no un callback: se reescribe a mano
        // para no reconstruir la grafica al entrar o salir del caso de un dia.
        gr.options.scales.x.offset = estilo.centrado;
      });
  }

  /* Productividad por tecnico: barra apilada de tres tramos que SUMAN
     exactamente lo resuelto en el rango (fecha de solucion):
       Dentro SLA        = TicketsDentroSla        (verde)
       Sin SLA evaluable = TicketsSinSlaEvaluable  (amarillo)
       SLA vencidos      = TicketsSlaVencidos      (rojo)
     Reabiertos NO es un cuarto tramo: se solapa con los tres; va en el
     tooltip. Con un backend anterior (sin TicketsDentroSla) se cae al reparto
     viejo cerrados/abiertos/vencidos -ver tramosProductividad-.
     El total a la derecha es TicketsTotales tal cual. Vive fuera de
     renderProductividad() por el mismo motivo que rangosBucketVigente: el
     tooltip y el plugin son los de la PRIMERA construccion y leen aqui la
     fila vigente. */
  let productividadVigente = [];

  // Las cuentas que no son personas ya no se excluyen con una lista escrita
  // aqui: productividad.ashx las deja fuera con dbo.CatCuentaNoPersona (o, si
  // el catalogo aun no esta en la base, con las dos cuentas que esta lista
  // tenia). Con filtros por clic se quitan del detalle con EsPersona, ANTES
  // del Top 15, para que entre otro en su lugar.

  // Mismos colores y posiciones de siempre; cambia lo que mide cada tramo.
  const PROD_SERIES = [
    { clave: 'segCer', label: 'Dentro SLA',        color: '#4CAF50' },
    { clave: 'segAb',  label: 'Sin SLA evaluable', color: '#eab308' },
    { clave: 'segVen', label: 'SLA vencidos',      color: '#f87171' },
  ];

  // Tramos de una fila. Con el backend nuevo, el reparto dentro / sin SLA /
  // vencidos, que suma TicketsResueltos. Con uno anterior (sin
  // TicketsDentroSla), el reparto viejo, sin inventar datos.
  function tramosProductividad(r) {
    const n = v => Number(v) || 0;
    if (r.TicketsDentroSla != null) {
      return {
        segCer: n(r.TicketsDentroSla),
        segAb:  n(r.TicketsSinSlaEvaluable),
        segVen: n(r.TicketsSlaVencidos),
      };
    }
    const cerVen = n(r.TicketsCerradosSlaVencidos), abVen = n(r.TicketsAbiertosSlaVencidos);
    return {
      segCer: Math.max(0, n(r.TicketsCerrados) - cerVen),
      segAb:  Math.max(0, n(r.TicketsAbiertos) - abVen),
      segVen: cerVen + abVen,
    };
  }

  // TicketsTotales FUERA, justo despues de la punta de la barra COMPLETA: la
  // posicion la da el tramo visible que llega mas a la derecha y el VALOR es
  // productividadVigente[i].TicketsTotales, el total autoritativo.
  const CIFRA_PUNTA = {
    id: 'cifraPunta',
    afterDatasetsDraw(chart) {
      const ctx = chart.ctx;
      const metas = chart.data.datasets.map((_, d) => chart.getDatasetMeta(d));
      ctx.save();
      ctx.font = '600 11px system-ui, -apple-system, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#393939';
      ctx.textAlign = 'left';
      productividadVigente.forEach((r, i) => {
        if (!r || r.TicketsTotales == null) return;
        let punta = null, y = null;
        metas.forEach(m => {
          if (!m || m.hidden || !m.data[i]) return;
          const b = m.data[i];
          if (punta === null || b.x > punta) { punta = b.x; y = b.y; }
        });
        if (punta === null) return;
        ctx.fillText(FMT(r.TicketsTotales), punta + 6, y);
      });
      ctx.restore();
    },
  };

  // Aire a la derecha del area para que la cifra de la barra mas larga no la
  // corte la tarjeta: ~7px por caracter del numero mas ancho mas el hueco.
  function airePunta(valores) {
    const ancho = Math.max(1, ...valores.map(v => FMT(v).length));
    return 12 + ancho * 7;
  }

  // Nombre del tecnico en el eje Y. Entero mientras quepa en ~un tercio del
  // ancho de la grafica; si no, se corta con "…" -el tooltip lo da completo-.
  function nombreEje(nombre, anchoGrafica) {
    const s = String(nombre ?? '');
    const max = Math.max(12, Math.floor((anchoGrafica || 0) * 0.34 / 6.2));
    return s.length > max ? s.slice(0, max - 1).trimEnd() + '…' : s;
  }

  /* Tooltip HTML (external de Chart.js): el de canvas no alinea cifras a la
     derecha ni pinta separador. Arriba los tres tramos con su punto de color;
     bajo la raya, Total y los indicadores. Solo los campos que vienen en la
     fila: con filtros por clic el ranking se recalcula sobre `detalle` y ahi
     no hay SlaEvaluable, asi que no se pinta un "0" que parezca un dato. */
  function tooltipProductividad({ chart, tooltip }) {
    const cont = chart.canvas.parentNode;
    let el = cont.querySelector('.tt-prod');
    if (!el) {
      el = document.createElement('div');
      el.className = 'tt-prod';
      el.style.cssText = 'position:absolute;pointer-events:none;z-index:5;min-width:190px;'
        + 'background:#fff;border:1px solid #e6e8ec;border-radius:10px;padding:10px 12px;'
        + 'box-shadow:0 6px 18px rgba(20,24,31,.12);font:12px system-ui,-apple-system,sans-serif;'
        + 'color:#393939;transition:opacity .12s;';
      if (getComputedStyle(cont).position === 'static') cont.style.position = 'relative';
      cont.appendChild(el);
    }
    const i = tooltip.dataPoints && tooltip.dataPoints.length ? tooltip.dataPoints[0].dataIndex : -1;
    const r = productividadVigente[i];
    if (!tooltip.opacity || !r) { el.style.opacity = 0; return; }

    const num = v => v !== null && v !== undefined && v !== '' && isFinite(Number(v));
    const dec = v => Number(v).toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fila = (izq, der) => `<div style="display:flex;justify-content:space-between;gap:18px;line-height:1.7">`
      + `<span>${izq}</span><span style="font-variant-numeric:tabular-nums">${der}</span></div>`;
    const punto = c => `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:7px"></span>`;

    let html = `<div style="font-weight:700;font-size:13px;margin-bottom:4px">${esc(r.Tecnico)}</div>`;
    PROD_SERIES.forEach(s => { html += fila(punto(s.color) + s.label, FMT(r[s.clave])); });
    html += '<div style="border-top:1px solid #e6e8ec;margin:6px 0 4px"></div>';
    html += fila('Resueltos', FMT(r.TicketsTotales));
    if (num(r.TicketsReabiertos))       html += fila('Reabiertos', FMT(r.TicketsReabiertos));
    if (num(r.CumplimientoSlaPct))      html += fila('Cumplimiento SLA', `${dec(r.CumplimientoSlaPct)}%`);
    if (num(r.HorasResolucionPromedio)) html += fila('Prom. resolución', `${dec(r.HorasResolucionPromedio)} h`);
    el.innerHTML = html;

    // A la derecha del cursor; si no cabe, a la izquierda. Sin salirse abajo.
    const x0 = chart.canvas.offsetLeft, y0 = chart.canvas.offsetTop;
    let x = x0 + tooltip.caretX + 14;
    if (x + el.offsetWidth > x0 + chart.width) x = x0 + tooltip.caretX - el.offsetWidth - 14;
    let y = y0 + tooltip.caretY - el.offsetHeight / 2;
    y = Math.max(y0, Math.min(y, y0 + chart.height - el.offsetHeight));
    el.style.left = `${Math.max(x0, x)}px`;
    el.style.top = `${y}px`;
    el.style.opacity = 1;
  }

  function renderProductividad() {
    let top;

    if (!hayFiltro()) {
      // Filas del SP tal cual, con todos sus campos: el tooltip las lee.
      top = (datos.productividad || []).slice(0, 15);
    } else {
      const f = filas(null);
      const m = new Map();
      for (const r of f) {
        if (noEsPersona(r)) continue;
        const t = r.Tecnico || '(sin tecnico)';
        if (!m.has(t)) m.set(t, { tot: 0, den: 0, sin: 0, ven: 0, reab: 0, hSum: 0, hN: 0 });
        const a = m.get(t);
        const vencido = r.SlaVencido === true || r.SlaVencido === 1;
        const dentro = r.DentroSla === true || r.DentroSla === 1;
        a.tot++;
        // Mismo reparto que el servidor: con veredicto es dentro o vencido;
        // sin veredicto, no tenia fecha compromiso.
        if (vencido) a.ven++; else if (dentro) a.den++; else a.sin++;
        if (esReabierto(r)) a.reab++;
        const h = r.HorasResolucion;
        if (h !== null && h !== undefined && h !== '' && isFinite(Number(h))) { a.hSum += Number(h); a.hN++; }
      }
      top = [...m.entries()].sort((a, b) => b[1].tot - a[1].tot).slice(0, 15)
        .map(([t, a]) => ({
          Tecnico: t, TicketsTotales: a.tot, TicketsResueltos: a.tot,
          TicketsDentroSla: a.den, TicketsSinSlaEvaluable: a.sin, TicketsSlaVencidos: a.ven,
          TicketsReabiertos: a.reab,
          HorasResolucionPromedio: a.hN ? a.hSum / a.hN : null,
        }));
    }

    // Copia con los tramos calculados: no se tocan las filas de `datos`.
    top = top.map(r => ({ ...r, ...tramosProductividad(r) }));
    const etiquetas = top.map(x => x.Tecnico);
    const totales = top.map(x => x.TicketsTotales);
    const series = PROD_SERIES.map(s => top.map(x => x[s.clave]));
    productividadVigente = top;

    if (!etiquetas.length) {
      destruir('productividad');
      return renderEmptyChart('chart-productividad', hayFiltro()
        ? 'Ningun tecnico tiene tickets con los filtros activos.'
        : 'Nadie resolvio tickets en el rango de fechas.');
    }

    dibujarGrafico(graficos, 'productividad', 'chart-productividad',
      () => ({
        type: 'bar',
        plugins: [CIFRA_PUNTA],
        data: {
          labels: etiquetas,
          // Grosor: el default compartido de Barras.aplicarDefaults. Radio
          // casi recto: la barra se lee como un bloque, no como pildoras.
          datasets: PROD_SERIES.map((s, k) => ({
            label: s.label,
            data: series[k],
            backgroundColor: s.color,
            hoverBackgroundColor: s.color,
            borderRadius: 2,
            borderSkipped: false,
            stack: 'tickets',
          }))
        },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          layout: { padding: { right: airePunta(totales) } },
          interaction: { mode: 'index', axis: 'y', intersect: false },
          plugins: {
            legend: { display: true, position: 'bottom', align: 'start',
                      labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8,
                                padding: 18, color: '#393939', font: { size: 11 } } },
            tooltip: { enabled: false, external: tooltipProductividad }
          },
          scales: {
            x: { ...EJE_CONTEO,stacked: true,
                 grid: { color: 'rgba(25,25,25,.06)', drawTicks: false },
                 border: { display: false },
                 ticks: { ...EJE_CONTEO.ticks, color: '#8a8578', font: { size: 10 }, padding: 6, maxTicksLimit: 6 } },
            y: { stacked: true, grid: { display: false }, border: { display: false },
                 ticks: { color: '#393939', font: { size: 11 }, padding: 6, autoSkip: false,
                          callback(v) { return nombreEje(this.getLabelForValue(v), this.chart.width); } } },
          }
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        series.forEach((d, k) => { gr.data.datasets[k].data = d; });
        gr.options.layout.padding.right = airePunta(totales);
      });
  }

  /* Aqui vivia renderEstado(), la dona de Estado. Se retiro junto con la de
     Antiguedad: las dos eran la foto de hoy, que contesta el Backlog. */

  /* Cumplimiento de SLA a lo largo del periodo.

     Recibe el eje ya resuelto por renderTendencia -mismas etiquetas, misma
     agrupacion por dia, mes o SLOT, incluido el SLOT 0- y los dos conteos por
     bloque. El porcentaje se calcula AQUI dividiendo las sumas del bloque: un
     porcentaje diario no se puede promediar para sacar el del mes. El eje X
     lee el mismo estiloTendVigente y rangosBucketVigente que la tendencia. */
  const META_SLA = 90;

  function renderSlaTiempo(etiquetas, dentro, evaluables) {
    const hint = document.getElementById('hint-sla-tiempo');
    const totalNum = (dentro || []).reduce((a, b) => a + (Number(b) || 0), 0);
    const totalDen = (evaluables || []).reduce((a, b) => a + (Number(b) || 0), 0);

    if (!etiquetas.length || !totalDen) {
      destruir('slaTiempo');
      hint.textContent = '';
      return renderEmptyChart('chart-sla-tiempo', hayFiltro()
        ? 'Ningun ticket con SLA evaluable pasa los filtros activos.'
        : 'Ningun ticket del rango tiene SLA evaluable.');
    }

    // null y no cero cuando el bloque no tuvo evaluables: un cero se leeria
    // como "incumplimos todo" cuando no hubo nada que medir.
    const pct = etiquetas.map((_, i) => {
      const den = Number(evaluables[i]) || 0;
      return den ? Math.round(1000 * (Number(dentro[i]) || 0) / den) / 10 : null;
    });
    const global = Math.round(1000 * totalNum / totalDen) / 10;
    hint.textContent = `${global}% en el periodo · meta ${META_SLA}%`;
    const color = COLOR_SEM[SEM(global)];
    const meta = etiquetas.map(() => META_SLA);

    dibujarGrafico(graficos, 'slaTiempo', 'chart-sla-tiempo',
      () => ({
        type: 'line',
        data: {
          labels: etiquetas,
          datasets: [
            { label: 'Cumplimiento', data: pct, borderColor: color, backgroundColor: color,
              tension: .3, borderWidth: 2, pointRadius: estiloTendVigente.pointRadius,
              pointHoverRadius: estiloTendVigente.pointHoverRadius, spanGaps: false },
            // Meta como dataset y no como anotacion: el plugin de anotaciones
            // no esta cargado y no vale traerlo por una raya.
            { label: `Meta ${META_SLA}%`, data: meta, borderColor: NEUTRO_SEM, borderDash: [5, 4],
              borderWidth: 1, pointRadius: 0, pointHoverRadius: 0, fill: false },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              title: (items) => {
                const r = rangosBucketVigente && rangosBucketVigente[items[0].dataIndex];
                if (r) return `${items[0].label} · ${r.inicio} → ${r.fin}`;
                return fechaLargaTendencia(items[0].label);
              },
              label: c => {
                if (c.datasetIndex === 1) return `Meta: ${META_SLA}%`;
                if (c.raw === null) return 'Sin tickets evaluables';
                const g = graficos.slaTiempo && graficos.slaTiempo.$sla;
                if (!g) return `${c.raw}%`;
                return `${c.raw}% · ${FMT(g.dentro[c.dataIndex])} de ${FMT(g.evaluables[c.dataIndex])} evaluables`;
              }
            } },
          },
          scales: {
            x: {
              offset: estiloTendVigente.centrado,
              ticks: { autoSkip: false, maxRotation: 0, minRotation: 0,
                       callback: (_v, i) => estiloTendVigente.textos[i] ?? '' }
            },
            y: { beginAtZero: true, max: 100, ticks: { callback: v => `${v}%` } }
          }
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        const ds = gr.data.datasets[0];
        ds.data = pct;
        ds.borderColor = color;
        ds.backgroundColor = color;
        ds.pointRadius = estiloTendVigente.pointRadius;
        ds.pointHoverRadius = estiloTendVigente.pointHoverRadius;
        gr.data.datasets[1].data = meta;
        gr.options.scales.x.offset = estiloTendVigente.centrado;
      });
    // Los conteos del bloque para el tooltip, sobre la instancia viva: el
    // callback es el de la primera construccion y no ve este closure.
    if (graficos.slaTiempo) graficos.slaTiempo.$sla = { dentro, evaluables };
  }

  /* Reabiertos a lo largo del periodo.

     Mismo eje que la de cumplimiento -etiquetas, agrupacion por dia, mes o
     SLOT, incluido el SLOT 0, estiloTendVigente y rangosBucketVigente-,
     resuelto una sola vez en renderTendencia. El porcentaje de cada bloque es
     reabiertos entre resueltos de ese bloque, sumados: un porcentaje diario
     no se puede promediar. Reabierto = IntentosSolucion > 1, sobre lo
     resuelto por fecha de solucion y sin rechazados. */
  function renderReabiertosTiempo(etiquetas, reabiertos, resueltos) {
    const hint = document.getElementById('hint-reabiertos-tiempo');
    const totalNum = (reabiertos || []).reduce((a, b) => a + (Number(b) || 0), 0);
    const totalDen = (resueltos || []).reduce((a, b) => a + (Number(b) || 0), 0);

    if (!etiquetas.length || !totalDen) {
      destruir('reabiertosTiempo');
      hint.textContent = '';
      return renderEmptyChart('chart-reabiertos-tiempo', hayFiltro()
        ? 'Ningun ticket resuelto pasa los filtros activos.'
        : 'Sin tickets resueltos en el rango de fechas.');
    }

    // null y no cero cuando el bloque no resolvio nada: no hubo que medir.
    const pct = etiquetas.map((_, i) => {
      const den = Number(resueltos[i]) || 0;
      return den ? Math.round(1000 * (Number(reabiertos[i]) || 0) / den) / 10 : null;
    });
    const global = Math.round(1000 * totalNum / totalDen) / 10;
    hint.textContent = `${global}% en el periodo`;
    const color = COLOR_SEM[SEM_REABIERTOS(global)] || NEUTRO_SEM;

    dibujarGrafico(graficos, 'reabiertosTiempo', 'chart-reabiertos-tiempo',
      () => ({
        type: 'line',
        data: {
          labels: etiquetas,
          datasets: [
            { label: 'Reabiertos', data: pct, borderColor: color, backgroundColor: color,
              tension: .3, borderWidth: 2, pointRadius: estiloTendVigente.pointRadius,
              pointHoverRadius: estiloTendVigente.pointHoverRadius, spanGaps: false },
          ]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              title: (items) => {
                const r = rangosBucketVigente && rangosBucketVigente[items[0].dataIndex];
                if (r) return `${items[0].label} · ${r.inicio} → ${r.fin}`;
                return fechaLargaTendencia(items[0].label);
              },
              label: c => {
                if (c.raw === null) return 'Sin tickets resueltos';
                const g = graficos.reabiertosTiempo && graficos.reabiertosTiempo.$reab;
                if (!g) return `${c.raw}%`;
                return `${c.raw}% · ${FMT(g.reabiertos[c.dataIndex])} de ${FMT(g.resueltos[c.dataIndex])} resueltos`;
              }
            } },
          },
          scales: {
            x: {
              offset: estiloTendVigente.centrado,
              ticks: { autoSkip: false, maxRotation: 0, minRotation: 0,
                       callback: (_v, i) => estiloTendVigente.textos[i] ?? '' }
            },
            // Sin max fijo: el rango real ronda el 3-7% y un 0-100 dejaria
            // la linea pegada al suelo.
            y: { beginAtZero: true, ticks: { callback: v => `${v}%` } }
          }
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        const ds = gr.data.datasets[0];
        ds.data = pct;
        ds.borderColor = color;
        ds.backgroundColor = color;
        ds.pointRadius = estiloTendVigente.pointRadius;
        ds.pointHoverRadius = estiloTendVigente.pointHoverRadius;
        gr.options.scales.x.offset = estiloTendVigente.centrado;
      });
    // Igual que $sla: el tooltip lee los conteos vigentes de la instancia viva.
    if (graficos.reabiertosTiempo) graficos.reabiertosTiempo.$reab = { reabiertos, resueltos };
  }

  /* Donde se pierde el SLA: vencidos por grupo, en horizontal, con el
     cumplimiento del grupo en el tooltip. El color lo decide el cumplimiento
     del grupo, no su volumen. Sale agregado del servidor sobre todo el rango
     (distribucion.ashx) y NO participa del cross-filter: el grupo ya es un
     filtro de la barra de arriba. */
  function renderVencidosGrupo() {
    const filasG = (datos && datos.distribucion && datos.distribucion.vencidosGrupo) || [];
    if (!filasG.length) {
      destruir('vencidosGrupo');
      // Que no haya vencidos es buena noticia, no un tablero roto.
      return renderEmptyChart('chart-vencidos-grupo', 'Ningun grupo tiene tickets vencidos en el rango.');
    }

    const etiquetas = filasG.map(x => String(x.Valor ?? ''));
    const valores = filasG.map(x => Number(x.Vencidos) || 0);
    const colores = filasG.map(x => {
      const c = x.CumplimientoPct;
      return (c === null || c === undefined) ? NEUTRO_SEM : COLOR_SEM[SEM(Number(c))];
    });

    dibujarGrafico(graficos, 'vencidosGrupo', 'chart-vencidos-grupo',
      () => ({
        type: 'bar',
        data: { labels: etiquetas, datasets: [{ data: valores, backgroundColor: colores, borderRadius: 4 }] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              label: c => `Vencidos: ${FMT(c.raw)}`,
              afterLabel: c => {
                const lista = (datos && datos.distribucion && datos.distribucion.vencidosGrupo) || [];
                const x = lista[c.dataIndex];
                if (!x) return '';
                const cum = (x.CumplimientoPct === null || x.CumplimientoPct === undefined)
                  ? 'sin SLA evaluable' : `cumplimiento ${x.CumplimientoPct}%`;
                return `${cum} · ${FMT(x.Evaluables)} evaluables`;
              }
            } },
          },
          scales: { x: EJE_CONTEO }
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        gr.data.datasets[0].data = valores;
        gr.data.datasets[0].backgroundColor = colores;
      });
  }

  /* Reabiertos por grupo: el PORCENTAJE, no el volumen -el grupo mas grande
     seria siempre la barra mas larga-. El conteo va en el tooltip. El
     servidor deja fuera a los grupos con menos de 50 resueltos. Igual que
     vencidos por grupo, no participa del cross-filter. */
  function renderReabiertosGrupo() {
    const hint = document.getElementById('hint-reabiertos');
    const filasG = (datos && datos.distribucion && datos.distribucion.reabiertosGrupo) || [];

    if (!filasG.length) {
      destruir('reabiertosGrupo');
      hint.textContent = '';
      return renderEmptyChart('chart-reabiertos-grupo',
        'Ningun grupo con 50 o mas resueltos tiene reabiertos en el rango.');
    }

    hint.textContent = 'minimo 50 resueltos';
    const etiquetas = filasG.map(x => String(x.Valor ?? ''));
    const valores = filasG.map(x => Number(x.ReabiertosPct) || 0);
    const colores = filasG.map(x => COLOR_SEM[SEM_REABIERTOS(x.ReabiertosPct)] || NEUTRO_SEM);

    dibujarGrafico(graficos, 'reabiertosGrupo', 'chart-reabiertos-grupo',
      () => ({
        type: 'bar',
        data: { labels: etiquetas, datasets: [{ data: valores, backgroundColor: colores, borderRadius: 4 }] },
        options: {
          indexAxis: 'y', responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              label: c => `${c.raw}% reabiertos`,
              afterLabel: c => {
                const lista = (datos && datos.distribucion && datos.distribucion.reabiertosGrupo) || [];
                const x = lista[c.dataIndex];
                return x ? `${FMT(x.Reabiertos)} de ${FMT(x.Resueltos)} resueltos` : '';
              }
            } },
          },
          scales: { x: { beginAtZero: true, ticks: { callback: v => `${v}%` } } }
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        gr.data.datasets[0].data = valores;
        gr.data.datasets[0].backgroundColor = colores;
      });
  }

  function renderBarraDim(idCanvas, idGrafico, dim, orden, colorFn, mensajeVacio) {
    const ent = entradasDim(dim, orden);
    const etiquetas = ent.map(e => e[0]);
    const valores = ent.map(e => e[1]);
    const colores = etiquetas.map((l, i) => colorFn(l, i));
    const sel = bordesSeleccion(etiquetas, filtro[dim], 0);

    if (!etiquetas.length) {
      destruir(idGrafico);
      return renderEmptyChart(idCanvas, mensajeVacio);
    }

    dibujarGrafico(graficos, idGrafico, idCanvas,
      () => ({
        type: 'bar',
        /* Cifra dentro (assets/js/barras.js); las medidas ya vienen del
           default compartido. El color lo sigue poniendo colorFn -prioridad y
           rampa de antiguedad-: aqui no se decide ningun color. */
        plugins: [Barras.etiquetasDentro(FMT)],
        data: { labels: etiquetas, datasets: [{ ...Barras.GRUESA, data: valores, backgroundColor: colores,
          borderColor: sel.borderColor, borderWidth: sel.borderWidth, borderRadius: 6 }] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false },
            tooltip: { callbacks: { label: c => `Tickets: ${FMT(c.raw)}` } } },
          scales: { y: EJE_CONTEO },
          onClick: (evt, _els, gr) => alternarFiltro(dim, etiquetaDelClic(gr, evt)),
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        const ds = gr.data.datasets[0];
        ds.data = valores;
        ds.backgroundColor = colores;
        ds.borderColor = sel.borderColor;
        ds.borderWidth = sel.borderWidth;
      });
  }

  // ------------------------------------------ personas con mas tickets resueltos
  // Ranking independiente del cross-filter: se pide aparte a productividad.ashx
  // con el rango de fechas y SOLO el filtro de Grupos, asi que ni el filtro de
  // Tecnicos ni los filtros por clic del tablero lo mueven.
  //
  // Ordena por RESUELTOS (fecha de solucion). "Ya cerrados" son los resueltos
  // que ademas tienen firma de cierre: el cierre lo pone Proactivanet despues,
  // asi que la diferencia es tramite pendiente, no trabajo sin hacer.
  const TOPE_CERRADOS = 10;

  // 'YYYY-MM-DD' -> 'DD/MM/YYYY' (solo para mostrar; no se reinterpreta como
  // fecha para no arrastrar la zona horaria del navegador).
  function fechaLarga(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
  }

  // Periodo activo del ranking, visible junto a la tabla: deja claro que esta
  // tabla no responde al rango de fechas de los filtros de arriba.
  function periodoRanking() {
    const r = rangoRanking();
    // El encabezado se decide por el modo. Antes miraba un `r.slots` que
    // rangoRanking dejo de devolver cuando el SLOT paso a fijar el rango del
    // tablero: siempre venia vacio, asi que la tabla decia "ultimos 7 dias
    // completos" mientras contaba los 60 dias de dos SLOTs. Es el mismo texto
    // que el pie de la tendencia, para que no haya dos formas de nombrar el
    // mismo periodo.
    const cab = enModoSlot()
      ? `Periodo: ${resumenSlots(slotsAplicados)}`
      : `Periodo: últimos ${DIAS_RANKING} días completos`;
    return `${cab} · ${fechaLarga(r.inicio)} → ${fechaLarga(r.fin)}`;
  }

  function descripcionTopCerrados(totalCerrados, personas, mostradas) {
    const g = seleccionados('f-grupos');
    const txt = g.length ? `Grupos: ${escapeHtml(g.join(' · '))}` : 'todos los grupos';
    const per = `<span class="suave">${escapeHtml(periodoRanking())}</span><br>`;
    if (!personas) return `${per}0 tickets resueltos <span class="suave">· ${txt}</span>`;
    const corte = mostradas < personas
      ? ` · top ${mostradas} de ${FMT(personas)} personas` : '';
    return `${per}${FMT(totalCerrados)} tickets resueltos <span class="suave">· ${txt}${corte}</span>`;
  }

  function renderTopCerrados() {
    const cont = document.getElementById('tabla-top-cerrados');
    const cap = document.getElementById('cap-top-cerrados');
    /* `cerrados` es la cifra que ordena -ahora los RESUELTOS- y `totales` la
       de contraste -los ya cerrados-; conservan el nombre para no tocar el
       armado de la tabla. Con un backend anterior, resueltos cae a
       TicketsTotales y la tabla se lee como antes. */
    const ranking = (datos.topCerrados || [])
      .map(x => ({
        tecnico: x.Tecnico || '(sin tecnico)',
        grupo: x.Grupo || '',
        cerrados: Number(x.TicketsResueltos ?? x.TicketsTotales) || 0,
        totales: Number(x.TicketsCerrados) || 0,
      }))
      .filter(x => x.cerrados > 0)
      .sort((a, b) => b.cerrados - a.cerrados);

    if (!ranking.length) {
      cont.innerHTML = `<div class="vacio">Sin tickets resueltos en ${
        enModoSlot() ? 'los SLOT seleccionados' : `los ultimos ${DIAS_RANKING} dias completos`
      } para estos grupos.</div>`;
      cap.innerHTML = descripcionTopCerrados(0, 0, 0);
      return;
    }

    const totalCerrados = ranking.reduce((a, x) => a + x.cerrados, 0);
    const tope = ranking[0].cerrados;
    const visibles = ranking.slice(0, TOPE_CERRADOS);

    const filasHtml = visibles.map((x, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${escapeHtml(x.tecnico)}</td>
        <td>${escapeHtml(x.grupo)}</td>
        <td class="num"><b>${FMT(x.cerrados)}</b>
          ${miniBar(tope > 0 ? 100 * x.cerrados / tope : 0, BARRA_B)}</td>
        <td class="num">${FMT(x.totales)}</td>
        <td class="num">${PCT(x.totales, x.cerrados)}</td>
        <td class="num">${PCT(x.cerrados, totalCerrados)}</td>
      </tr>`).join('');

    cont.innerHTML = `<table><thead><tr>
        <th class="num">#</th><th>Persona</th><th>Grupo</th>
        <th class="num">Tickets resueltos</th><th class="num">Ya cerrados</th>
        <th class="num">% ya cerrados</th><th class="num">% del total resuelto</th>
      </tr></thead><tbody>${filasHtml}</tbody></table>`;
    hacerOrdenable(cont.querySelector('table'));

    cap.innerHTML = descripcionTopCerrados(totalCerrados, ranking.length, visibles.length);
  }

  /* motivo === 'filtro' -> el repintado viene de un cambio de cross-filter.
     El ranking de cerrados (topCerrados, que se pide aparte y a proposito
     ignora el cross-filter) y el stepper de SLOT no dependen de `filtro`:
     recalcularlos en cada clic reconstruia una tabla de 10 filas con sus
     listeners de ordenacion para nada. Todo lo que SI depende del filtro se
     sigue repintando en el mismo ciclo, asi que ninguna grafica queda vieja. */
  /* ------------------------------------------- Call Center de Servicios TI
     Un solo dataset (`llamadas`, de llamadas.ashx) alimenta las tarjetas, las
     cuatro graficas y el catalogo de campanas.

     Este bloque NO participa del cross-filter: una llamada no comparte
     dimension con un ticket (no tiene estado, prioridad ni antiguedad), asi
     que el objeto `filtro` no lo toca y renderTodo() solo lo repinta cuando
     llegan datos nuevos, no en cada clic sobre las graficas de SLA. Sus
     unicas entradas son el rango de fechas -compartido con los tickets- y el
     filtro propio de campanas.

     Reusa lo que ya hay: obtenerJSON, htmlTarjetasKpi, dibujarGrafico,
     renderEmptyChart, EJE_CONTEO, la paleta compartida y las clases de
     semaforo sv/sa/sr. No define ningun color ni ningun render propio. */

  // mm:ss. Los segundos crudos ('194') no dicen nada de un vistazo; en un Call
  // Center todo el mundo lee 3:14.
  function mmss(segundos) {
    if (segundos === null || segundos === undefined) return 'N/D';
    const s = Math.round(Number(segundos));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  /* El abandono es el KPI que se mira primero, y aqui MENOS es mejor: se
     colorea al reves que el cumplimiento de SLA. Mismas clases que SEM
     (sv/sa/sr), solo cambia el sentido de los cortes. */
  const SEM_ABANDONO = pct => pct <= 10 ? 'sv' : (pct <= 20 ? 'sa' : 'sr');

  function renderKpisLlamadas() {
    const cont = document.getElementById('kpis-llamadas');
    if (!cont) return;
    const k = (datos && datos.llamadas && datos.llamadas.kpis) || {};

    const total = k.Llamadas ?? 0;
    const contestadas = k.Contestadas ?? 0;
    const abandonadas = k.Abandonadas ?? 0;
    // Colgaron antes del minuto. Va aparte de 'abandonadas': el backend ya
    // dejo en Abandonadas solo las que aguantaron mas de un minuto, asi que el
    // abandono total -el que mide AbandonoPct- es la suma de las dos.
    // El procedimiento de la VM la devuelve como 'ColgadasRapido'; el del repo,
    // como 'ColgaronRapido'. Se aceptan los dos nombres.
    const colgaronRapido = k.ColgadasRapido ?? k.ColgaronRapido ?? 0;
    const abandonoTotal = abandonadas + colgaronRapido;
    const aband = k.AbandonoPct ?? null;
    const nivel = k.NivelServicioPct ?? null;
    const umbral = k.UmbralNivelServicioSeg ?? 20;

    cont.innerHTML = htmlTarjetasKpi([
      { l: 'Llamadas recibidas', v: FMT(total),
        f: `${FMT(contestadas)} contestadas · ${FMT(abandonoTotal)} abandonadas` },
      { l: '% de abandono', v: aband !== null ? `${aband}%` : '—',
        s: aband !== null ? SEM_ABANDONO(aband) : '',
        f: `${FMT(abandonoTotal)} de ${FMT(total)}` },
      { l: 'Abandonadas (> 1 min)', v: FMT(abandonadas),
        f: `esperaron mas de un minuto antes de colgar` },
      { l: 'Colgaron antes del minuto', v: FMT(colgaronRapido),
        f: `abandono rapido, sin llegar al minuto` },
      // El umbral se escribe "menos de Ns" a proposito: la tarjeta se inyecta
      // con innerHTML y un '<' suelto abre una etiqueta que se come el texto.
      { l: 'Nivel de servicio', v: nivel !== null ? `${nivel}%` : '—',
        s: nivel !== null ? SEM(nivel) : '',
        f: `contestadas en menos de ${umbral}s` },
      { l: 'Espera promedio', v: mmss(k.EsperaPromSeg),
        f: `antes de colgar: ${mmss(k.EsperaPromAbanSeg)}` },
      { l: 'Duracion promedio', v: mmss(k.DuracionPromSeg),
        f: `${FMT(k.PromedioDiario ?? 0)} llamadas por dia` },
      { l: 'Agentes activos', v: FMT(k.AgentesActivos ?? 0) },
    ]);
  }

  function renderLlamadasDia() {
    const f = (datos && datos.llamadas && datos.llamadas.tendencia) || [];
    if (!f.length) {
      destruir('llamadasDia');
      return renderEmptyChart('chart-llamadas-dia', 'Sin llamadas en el rango seleccionado.');
    }
    // Misma forma de fecha que tendencia.ashx: "aaaa-mm-ddT00:00:00".
    const etiquetas = f.map(x => soloFecha(x.Fecha));
    const series = [
      { label: 'Recibidas', data: f.map(x => x.Llamadas), color: AZUL },
      { label: 'Contestadas', data: f.map(x => x.Contestadas), color: VERDE_S },
      { label: 'Abandonadas', data: f.map(x => x.Abandonadas), color: ROJO },
    ];

    dibujarGrafico(graficos, 'llamadasDia', 'chart-llamadas-dia',
      () => ({
        type: 'line',
        data: { labels: etiquetas, datasets: series.map(s => ({
          label: s.label, data: s.data, borderColor: s.color, backgroundColor: s.color,
          tension: 0.25, pointRadius: 0, borderWidth: 2 })) },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${FMT(c.raw)}` } } },
          scales: { y: EJE_CONTEO },
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        series.forEach((s, i) => { gr.data.datasets[i].data = s.data; });
      });
  }

  /* Volumen en barras y % de abandono en linea sobre un segundo eje: una
     campana chica con 60% de abandono se pierde si solo se mira el volumen. */
  function renderLlamadasCampana() {
    const f = (datos && datos.llamadas && datos.llamadas.campana) || [];
    if (!f.length) {
      destruir('llamadasCampana');
      return renderEmptyChart('chart-llamadas-campana', 'Sin llamadas en el rango seleccionado.');
    }
    const etiquetas = f.map(x => x.Campana);
    const volumen = f.map(x => x.Llamadas);
    const abandono = f.map(x => x.AbandonoPct);

    dibujarGrafico(graficos, 'llamadasCampana', 'chart-llamadas-campana',
      () => ({
        type: 'bar',
        /* La cifra dentro de la barra, como en el resto del tablero. El
           plugin compartido solo mira los datasets de tipo `bar`, asi que la
           serie de % -que es linea- se queda con su tooltip. */
        plugins: [ETIQUETAS_DENTRO],
        data: { labels: etiquetas, datasets: [
          { label: 'Llamadas', data: volumen, backgroundColor: AZUL, yAxisID: 'y' },
          { label: '% abandono', data: abandono, type: 'line', borderColor: ROJO,
            backgroundColor: ROJO, tension: 0.25, pointRadius: 3, borderWidth: 2, yAxisID: 'y1' },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false,
          scales: {
            y: Object.assign({}, EJE_CONTEO, { position: 'left' }),
            y1: { beginAtZero: true, position: 'right', grid: { drawOnChartArea: false },
                  ticks: { callback: v => `${v}%` } },
          }
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        gr.data.datasets[0].data = volumen;
        gr.data.datasets[1].data = abandono;
      });
  }

  function renderLlamadasHora() {
    const f = (datos && datos.llamadas && datos.llamadas.hora) || [];
    if (!f.length) {
      destruir('llamadasHora');
      return renderEmptyChart('chart-llamadas-hora', 'Sin llamadas en el rango seleccionado.');
    }
    const etiquetas = f.map(x => `${String(x.Hora).padStart(2, '0')}:00`);
    const contestadas = f.map(x => x.Contestadas);
    const abandonadas = f.map(x => x.Abandonadas);

    /* Aire local, y SOLO aqui: mismo caso que "Por antiguedad" del Backlog
       pero peor, porque aqui son 24 cubos. Con el juego compartido -.9 x .9,
       la barra en el 81% de su ranura- las columnas quedan pegadas y el dia
       se lee como una sola mancha. Con .72 x .86 la barra ocupa el 62% y cada
       hora se separa de la siguiente. El tope de grosor y el radio siguen
       siendo los del default compartido: solo se cambia el reparto de la
       ranura, y solo en esta grafica. */
    const AIRE_HORA = { categoryPercentage: 0.72, barPercentage: 0.86 };

    dibujarGrafico(graficos, 'llamadasHora', 'chart-llamadas-hora',
      () => ({
        type: 'bar',
        // Apilada: la cifra la pone ETIQUETAS_SEGMENTO, que sabe de segmentos
        // y omite el que no da la caja en vez de sacar el numero afuera.
        plugins: [ETIQUETAS_SEGMENTO],
        data: { labels: etiquetas, datasets: [
          { ...AIRE_HORA, label: 'Contestadas', data: contestadas, backgroundColor: VERDE_S },
          { ...AIRE_HORA, label: 'Abandonadas', data: abandonadas, backgroundColor: ROJO },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${FMT(c.raw)}` } } },
          scales: { x: { stacked: true }, y: Object.assign({}, EJE_CONTEO, { stacked: true }) },
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        gr.data.datasets[0].data = contestadas;
        gr.data.datasets[1].data = abandonadas;
      });
  }

  function renderLlamadasAgente() {
    const f = (datos && datos.llamadas && datos.llamadas.agente) || [];
    if (!f.length) {
      destruir('llamadasAgente');
      return renderEmptyChart('chart-llamadas-agente', 'Sin llamadas atendidas en el rango seleccionado.');
    }
    const etiquetas = f.map(x => x.Agente);
    const atendidas = f.map(x => x.Atendidas);
    // El tooltip lee la duracion por posicion, asi que se congela junto con
    // las series: si llegan datos nuevos, este arreglo se reemplaza entero.
    const duraciones = f.map(x => x.DuracionPromSeg);

    dibujarGrafico(graficos, 'llamadasAgente', 'chart-llamadas-agente',
      () => ({
        type: 'bar',
        // Cifra dentro de la barra: el plugin compartido mide a lo ancho
        // cuando indexAxis es 'y', asi que la grafica sigue horizontal.
        plugins: [ETIQUETAS_DENTRO],
        data: { labels: etiquetas, datasets: [{ label: 'Llamadas atendidas',
          data: atendidas, backgroundColor: MORADO }] },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: {
              label: c => `Atendidas: ${FMT(c.raw)}`,
              afterLabel: c => `Duracion promedio: ${mmss(duraciones[c.dataIndex])}`,
            } },
          },
          scales: { x: EJE_CONTEO },
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        gr.data.datasets[0].data = atendidas;
        // El closure del tooltip apunta al arreglo de ESTA pasada, no al de la
        // construccion: hay que reinstalarlo para que las duraciones casen.
        gr.options.plugins.tooltip.callbacks.afterLabel =
          c => `Duracion promedio: ${mmss(duraciones[c.dataIndex])}`;
      });
  }

  /* El catalogo de campanas viaja con los datos y se llena UNA sola vez: si se
     repoblara en cada carga se perderia la campana que el usuario acaba de
     elegir. El MutationObserver del multi-select redibuja su panel solo. */
  function llenarCatalogoCampanas() {
    const sel = document.getElementById('f-campanas');
    if (!sel || sel.options.length) return;
    const cat = (datos && datos.llamadas && datos.llamadas.catalogo) || [];
    if (!cat.length) return;
    sel.innerHTML = cat.map(c =>
      `<option value="${escapeAttr(String(c.NumeroCola))}">${escapeHtml(c.Campana)}</option>`).join('');
  }

  function renderLlamadas() {
    llenarCatalogoCampanas();
    renderKpisLlamadas();
    renderLlamadasDia();
    renderLlamadasCampana();
    renderLlamadasHora();
    renderLlamadasAgente();
  }


  /* ----------------------------------------------- Carga combinada
     Cruce de las dos fuentes en la misma fila: quien cierra pocos tickets
     porque se le fue el dia en el telefono. Sale de carga_combinada.ashx
     (dbo.usp_Dash_CargaCombinada) y solo trae a la gente que esta en
     dbo.CatAgenteTecnico, que es la que hace las dos cosas.

     Vive FUERA de `datos` y fuera de renderTodo() a proposito: su peticion
     va aparte de las demas del tablero (ver cargarTodo) y se pinta sola en
     cuanto responde, sin esperar ni afectar al resto del Call Center.

     Reusa lo que ya hay: dibujarGrafico, destruir, EJE_CONTEO, la paleta
     compartida y hacerOrdenable. No define ningun color propio. */

  // Filas que pide el procedimiento. La grafica solo dibuja las 15 primeras
  // -en un panel de 320px, 20 barras quedan de tres pixeles-; la tabla de
  // abajo si las trae todas.
  const TOPE_CARGA = 20;
  const TOPE_CARGA_GRAFICA = 15;

  /* Mismo rango de fechas que los tickets y el MISMO filtro de Grupos: aqui
     el grupo si se usa, pero contra el grupo donde el tecnico tiene mas
     tickets (dbo.CatAgenteTecnico.Grupo), no contra el del ticket. El de
     Tecnicos se quita: el procedimiento no lo mira. */
  function paramsCargaCombinada() {
    const p = paramsFiltros();
    p.delete('tecnicos');
    /* El cruce es Call Center: nunca puede pedir un grupo que no atienda
       telefono. Acotar el <select> ya lo evita en la practica, pero el
       parametro se recorta igual aqui, que es por donde de verdad sale la
       peticion: la barra la comparten dos pestañas y lo que traiga puesto SLA
       no tiene por que llegar hasta aqui. Si no queda ninguno se quita el
       parametro y manda el valor por omision del handler, que es ese mismo
       par de grupos. */
    const permitidos = new Set(catalogos.gruposCall ?? []);
    const grupos = seleccionados('f-grupos').filter(g => permitidos.has(g));
    if (grupos.length) p.set('grupos', grupos.join(','));
    else p.delete('grupos');
    p.set('top', String(TOPE_CARGA));
    return p;
  }

  /* Muestra u oculta las dos graficas y la tabla en bloque. Cuando no hay
     cruce que pintar se esconden enteras: dos recuadros vacios y una tabla
     sin filas no explican nada, y el mensaje del estado si. */
  function mostrarBloqueCarga(visible) {
    ['graficos-carga', 'card-tabla-carga'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.style.display = visible ? '' : 'none';
    });
  }

  function estadoCargaCombinada(html) {
    const el = document.getElementById('estado-carga-combinada');
    if (!el) return;
    el.innerHTML = html ? `<div class="vacio">${html}</div>` : '';
  }

  function renderCargaTecnico(filas) {
    const top = filas.slice(0, TOPE_CARGA_GRAFICA);
    const etiquetas = top.map(x => x.Tecnico);
    const tickets = top.map(x => x.Tickets ?? 0);
    const llamadas = top.map(x => x.Llamadas ?? 0);
    // El pie del tooltip lee por posicion, asi que se congela junto con las
    // series: si llegan datos nuevos, este arreglo se reemplaza entero.
    const detalle = top.map(x => `Atenciones: ${FMT(x.Atenciones ?? 0)} \u00b7 ${x.LlamadasPct ?? 0}% llamadas \u00b7 ${FMT(x.MinutosHablados ?? 0)} min hablados`);
    const pie = items => detalle[items[0].dataIndex];

    dibujarGrafico(graficos, 'cargaTecnico', 'chart-carga-tecnico',
      () => ({
        type: 'bar',
        // Apilada, como la de antiguedad del Backlog pero tumbada: la cifra
        // de cada segmento la pone ETIQUETAS_SEGMENTO. La geometria -grosor,
        // aire y radio- ya viene del default compartido.
        plugins: [ETIQUETAS_SEGMENTO],
        data: { labels: etiquetas, datasets: [
          { label: 'Tickets cerrados', data: tickets, backgroundColor: BARRA_A },
          { label: 'Llamadas atendidas', data: llamadas, backgroundColor: MORADO },
        ] },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          /* Apiladas a proposito: el largo total de la barra es el total de
             atenciones y el color dice como se reparte. Lado a lado se
             compararia ticket contra llamada, que no es la pregunta. */
          scales: { x: Object.assign({}, EJE_CONTEO, { stacked: true }), y: { stacked: true } },
          plugins: {
            tooltip: { callbacks: {
              label: c => `${c.dataset.label}: ${FMT(c.raw)}`,
              // footer y no afterLabel: afterLabel se repetiria en cada uno de
              // los dos datasets del mismo tecnico.
              footer: pie,
            } },
          },
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        gr.data.datasets[0].data = tickets;
        gr.data.datasets[1].data = llamadas;
        // El closure apunta al arreglo de ESTA pasada, no al de la
        // construccion: hay que reinstalarlo para que el pie case.
        gr.options.plugins.tooltip.callbacks.footer = pie;
      });
  }

  function renderCargaDia(filas) {
    const etiquetas = filas.map(x => soloFecha(x.Fecha));
    const tickets = filas.map(x => x.Tickets ?? 0);
    const llamadas = filas.map(x => x.Llamadas ?? 0);

    dibujarGrafico(graficos, 'cargaDia', 'chart-carga-dia',
      () => ({
        type: 'line',
        data: { labels: etiquetas, datasets: [
          { label: 'Tickets cerrados', data: tickets, borderColor: BARRA_A,
            backgroundColor: BARRA_A, tension: 0.25, pointRadius: 0, borderWidth: 2 },
          { label: 'Llamadas atendidas', data: llamadas, borderColor: MORADO,
            backgroundColor: MORADO, tension: 0.25, pointRadius: 0, borderWidth: 2 },
        ] },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: { tooltip: { callbacks: { label: c => `${c.dataset.label}: ${FMT(c.raw)}` } } },
          scales: { y: EJE_CONTEO },
        }
      }),
      gr => {
        gr.data.labels = etiquetas;
        gr.data.datasets[0].data = tickets;
        gr.data.datasets[1].data = llamadas;
      });
  }

  function renderTablaCarga(filas) {
    const cont = document.getElementById('tabla-carga');
    if (!cont) return;
    const filasHtml = filas.map(x => `<tr>
        <td>${escapeHtml(x.Tecnico)}</td>
        <td>${escapeHtml(x.Grupo)}</td>
        <td class="num">${FMT(x.Tickets ?? 0)}</td>
        <td class="num">${FMT(x.Llamadas ?? 0)}</td>
        <td class="num"><b>${FMT(x.Atenciones ?? 0)}</b></td>
        <td class="num">${x.LlamadasPct ?? 0}%</td>
        <td class="num">${FMT(x.MinutosHablados ?? 0)}</td>
      </tr>`).join('');

    cont.innerHTML = `<table><thead><tr>
        <th>Tecnico</th><th>Grupo</th>
        <th class="num">Tickets cerrados</th><th class="num">Llamadas atendidas</th>
        <th class="num">Atenciones</th><th class="num">% llamadas</th>
        <th class="num">Minutos hablados</th>
      </tr></thead><tbody>${filasHtml}</tbody></table>`;
    hacerOrdenable(cont.querySelector('table'));
  }

  function renderCargaCombinada(d) {
    const filas = (d && d.tecnicos) || [];
    const hint = document.getElementById('hint-carga');
    if (hint) hint.textContent = (d && d.grupos) ? String(d.grupos) : '';

    if (!filas.length) {
      /* El caso mas probable no es que no haya habido actividad, sino que el
         catalogo de extensiones no este capturado para esos grupos, asi que
         se dice en vez de dejar dos recuadros vacios. */
      destruir('cargaTecnico');
      destruir('cargaDia');
      mostrarBloqueCarga(false);
      estadoCargaCombinada(`Sin cruce para este filtro. Se busco en los grupos: ${escapeHtml((d && d.grupos) || '')}.<br>Si el rango si tuvo actividad, revisa que dbo.CatAgenteTecnico tenga capturadas las extensiones de esos grupos.`);
      return;
    }

    estadoCargaCombinada('');
    mostrarBloqueCarga(true);
    renderCargaTecnico(filas);
    renderCargaDia((d && d.serie) || []);
    renderTablaCarga(filas);
  }

  function errorCargaCombinada(err) {
    destruir('cargaTecnico');
    destruir('cargaDia');
    mostrarBloqueCarga(false);
    const hint = document.getElementById('hint-carga');
    if (hint) hint.textContent = '';
    estadoCargaCombinada(`No se pudo cargar el cruce: ${escapeHtml((err && err.message) || err)}`);
    console.error(err);
  }

  function renderTodo(motivo) {
    perf.ini('renderTodo');
    renderKpis();
    renderTendencia();
    renderProductividad();
    renderBarraDim('chart-prioridad', 'prioridad', 'prioridad',
      null, l => COLOR_PRIORIDAD[l] ?? GRIS, 'Ningun ticket pasa los filtros activos.');
    // Desglose por grupo: agregado del servidor, no depende del cross-filter
    // (el de cumplimiento en el tiempo lo pinta renderTendencia).
    renderVencidosGrupo();
    renderReabiertosGrupo();
    if (motivo !== 'filtro') {
      renderSlotStepper();
      renderTopCerrados();
      // El Call Center no depende del cross-filter (ver bloque de arriba): se
      // repinta con los datos nuevos, no en cada clic sobre las graficas.
      renderLlamadas();
    }
    perf.fin('renderTodo');
  }

  /* Valor neutro de cada dataset cuando su peticion falla: el render ya trata
     estos casos como "sin datos" y pinta el estado vacio de siempre. */
  const DATASET_VACIO = {
    kpis: {}, tendencia: [], productividad: [],
    distribucion: { prioridad: [], vencidosGrupo: [], reabiertosGrupo: [] },
    detalle: [], topCerrados: [],
    // Call Center: si llamadas.ashx falla, el bloque pinta sus estados vacios
    // y el resto del tablero de SLA sigue igual que siempre.
    llamadas: { kpis: {}, tendencia: [], campana: [], hora: [], agente: [], catalogo: [] },
  };

  /* Los siete datasets se resuelven POR SEPARADO (allSettled), no con
     Promise.all. Con Promise.all el rechazo de uno solo -tipicamente
     `detalle`, que en un rango de UN dia no se puede trocear y solo puede
     bajar el tope de filas antes de rendirse- saltaba al catch y el tablero
     entero se quedaba sin pintar, aunque kpis/tendencia/distribucion hubieran
     respondido bien. Ahora cada dataset que llega se pinta; los que fallan
     dejan su estado vacio y aparecen listados en la barra de estado. */
  /* Auto-aplicado de los filtros. Los controles ya no esperan a ningun boton:
     cada cambio llama a programarCarga(), que agrupa los cambios seguidos -tres
     casillas de un multi-select, dos clics del stepper- en UNA sola peticion.
     Y como dos cargas pueden solaparse, cada una lleva su numero: la que ya no
     es la ultima descarta su respuesta y no pinta datos viejos encima. */
  const ESPERA_AUTO = 250;             // ms para agrupar cambios seguidos
  let cargaProgramada = null;
  let cargaVigente = 0;

  function programarCarga() {
    clearTimeout(cargaProgramada);
    cargaProgramada = setTimeout(() => { cargaProgramada = null; cargarTodo(); }, ESPERA_AUTO);
  }

  async function cargarTodo() {
    // Una carga inmediata ("Limpiar", rango rapido) manda sobre la programada.
    clearTimeout(cargaProgramada);
    cargaProgramada = null;
    const miCarga = ++cargaVigente;
    estadoCargando('estado-carga');
    const qs = paramsFiltros().toString();
    const qsGrupos = paramsRankingCerrados().toString();

    /* El cruce va APARTE del allSettled de abajo, con su propio manejo de
       error: depende de dbo.usp_Dash_CargaCombinada, que un servidor que
       todavia no corrio ese script no tiene. Metido en la lista, su fallo se
       sumaria a `fallos` y se anunciaria en la barra de estado como si el
       tablero entero hubiera venido incompleto, cuando lo unico que falta es
       el ultimo bloque del Call Center. Se lanza aqui para que salga en
       paralelo con las demas, y se pinta solo en cuanto responde. */
    estadoCargaCombinada('Cargando el cruce de tickets y llamadas...');
    obtenerJSON(`carga_combinada.ashx?${paramsCargaCombinada().toString()}`).then(
      d => { if (miCarga === cargaVigente) renderCargaCombinada(d); },
      e => { if (miCarga === cargaVigente) errorCargaCombinada(e); }
    ).catch(e => console.error(e));

    const peticiones = [
      ['kpis',          () => obtenerJSON(`kpis.ashx?${qs}`)],
      ['tendencia',     () => obtenerJSON(`tendencia.ashx?${qs}`)],
      ['productividad', () => obtenerJSON(`productividad.ashx?${qs}`)],
      ['distribucion',  () => obtenerJSON(`distribucion.ashx?${qs}`)],
      ['detalle',       () => obtenerDetalle(paramsFiltros(), TOPE_DETALLE)],
      ['topCerrados',   () => obtenerJSON(`productividad.ashx?${qsGrupos}`)],
      ['llamadas',      () => obtenerJSON(`llamadas.ashx?${paramsLlamadas().toString()}`)],
    ];

    const resueltos = await Promise.allSettled(peticiones.map(([, pedir]) => pedir()));
    // Llego tarde: otro cambio de filtro ya lanzo una carga posterior.
    if (miCarga !== cargaVigente) return;

    const nuevos = {};
    const fallos = [];
    resueltos.forEach((r, i) => {
      const nombre = peticiones[i][0];
      if (r.status === 'fulfilled') {
        nuevos[nombre] = r.value;
      } else {
        nuevos[nombre] = DATASET_VACIO[nombre];
        fallos.push({ nombre, error: r.reason });
      }
    });

    // Si NO llego nada, el tablero no tiene que fingir un estado vacio: es un
    // error de backend y se muestra como tal, igual que antes.
    if (fallos.length === peticiones.length) {
      datos = null;
      detalleDisponible = false;
      estadoError('estado-carga', fallos[0].error);
      return;
    }

    datos = nuevos;
    detalleDisponible = !fallos.some(f => f.nombre === 'detalle');
    // Cambiar el rango invalida cualquier seleccion previa del tablero.
    Object.keys(filtro).forEach(k => { filtro[k] = null; });
    invalidarFilas();
    renderTodo();
    estadoParcial('estado-carga', nuevos.kpis && nuevos.kpis.UltimaActualizacionEtl, fallos);
  }

  async function init() {
    document.querySelectorAll('#filtros-sla [data-rango]').forEach(btn => {
      btn.addEventListener('click', () => aplicarRangoRapido(btn.dataset.rango));
    });
    document.getElementById('btn-limpiar').addEventListener('click', () => {
      document.getElementById('f-grupos').selectedIndex = -1;
      document.getElementById('f-tecnicos').selectedIndex = -1;
      document.getElementById('f-campanas').selectedIndex = -1;
      // "Limpiar" deja el tablero como recien abierto: sin SLOT, sin cross
      // filter y con el mismo rango que escribe init(). Antes fijaba hoy a hoy
      // y la tendencia quedaba con un solo dia.
      desactivarSlots();
      escribirRango(rangoPorDefecto());
      Object.keys(filtro).forEach(k => { filtro[k] = null; });
      cargarTodo();
    });

    // Stepper de SLOTs: mueve el numero, pone su rango en vigor y recarga.
    // El debounce agrupa los clics seguidos en una sola peticion.
    document.getElementById('slot-mas').addEventListener('click', () => {
      slotsN = Math.min(slotsN + 1, MAX_SLOTS);
      aplicarSlots();
      programarCarga();
    });
    document.getElementById('slot-menos').addEventListener('click', () => {
      if (slotsN <= 0) return;       // 0 = SLOT apagado, no se baja mas
      slotsN--;                      // 1 -> 0 apaga el SLOT: manda el rango
      aplicarSlots();                // manual que haya escrito en las fechas
      programarCarga();
    });
    // Tocar una fecha a mano apaga el SLOT: si no, el rango del SLOT se
    // reescribiria encima y las fechas escritas se perderian.
    ['f-inicio', 'f-fin'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        desactivarSlots();
        programarCarga();
      });
    });
    // Grupos, tecnicos y campanas: el multi-select propio emite `change` sobre
    // el <select> original, asi que basta con escucharlo aqui.
    ['f-grupos', 'f-tecnicos', 'f-campanas'].forEach(id => {
      document.getElementById(id).addEventListener('change', programarCarga);
    });
    renderSlotStepper();             // estado inicial: sin SLOT, rango manual

    escribirRango(rangoPorDefecto());

    try {
      await cargarCatalogos();
    } catch (err) {
      estadoError('estado-carga', err);
      return;
    }
    await cargarTodo();
  }

  return { init, redimensionar: () => redimensionar(graficos), modoCallCenter };
})();

/* =======================================================================
   3. Tablero de Backlog
   ======================================================================= */
const TableroBacklog = (function () {
  // Misma paleta que usa el correo, en el mismo orden: un lider conserva su
  // color entre el correo, la grafica apilada y la tabla de resumen.
  // Identidad por lider: paleta categorica COMPARTIDA (assets/js/paleta.js).
  // El indice del lider en ordenLideres decide el color -no el orden de
  // pintado-, asi que un lider lleva el mismo color en la tendencia, la
  // antiguedad por lider, la tabla de resumen y los swatches.
  // AgingSort >= 5 es exactamente "mas de 30 dias" (ver 07_correo_backlog.sql).
  const SORT_MAS_30 = 5;

  const graficos = {};
  let datos = null;
  let ordenLideres = [];
  const filtro = { lider: null, grupo: null, prioridad: null, aging: null };
  const ETIQUETA_DIM = { lider: 'Lider', grupo: 'Grupo', prioridad: 'Prioridad', aging: 'Antiguedad' };

  function colorLider(nombre) {
    return Paleta.color(nombre, ordenLideres);
  }
  function hayFiltro() { return dimensionesActivas(filtro).length > 0; }
  // hayFiltro() solo mira el cross-filter de las graficas. Para los mensajes de
  // "sin datos" tambien cuentan los multiselect de arriba.
  function hayFiltroAlguno() {
    return hayFiltro()
      || ['f-c1-bl', 'f-grupos-bl', 'f-lideres-bl'].some(id => seleccionados(id).length > 0);
  }

  // Los 6 result sets son agregados completos por (Lider, Grupo): filtrar por
  // esas dos dimensiones es exacto, sin depender de ningun tope.
  function porLiderGrupo(conjunto, omitir) {
    return (conjunto || []).filter(x => {
      if (omitir !== 'lider' && filtro.lider !== null && x.Lider !== filtro.lider) return false;
      if (omitir !== 'grupo' && filtro.grupo !== null && x.Grupo !== filtro.grupo) return false;
      return true;
    });
  }
  // Prioridad y antiguedad viven en result sets distintos (marginales, no una
  // tabla cruzada), asi que solo pueden filtrar al conjunto al que pertenecen.
  function agingFiltrado(omitir) {
    return porLiderGrupo(datos.resumen.aging, omitir)
      .filter(x => omitir === 'aging' || filtro.aging === null || x.Aging === filtro.aging);
  }

  function alternarFiltro(dim, valor) {
    if (valor === null || valor === undefined) return;
    filtro[dim] = (filtro[dim] === valor) ? null : valor;
    // Cambiar de lider invalida el grupo elegido: puede no existir en el nuevo.
    if (dim === 'lider') filtro.grupo = null;
    renderTodo();
  }

  function paramsFiltros() {
    const p = new URLSearchParams();
    const corte = document.getElementById('f-corte-bl').value;
    if (corte) p.set('fecha_corte', corte);
    const c1 = seleccionados('f-c1-bl');
    const grupos = seleccionados('f-grupos-bl');
    const lideres = seleccionados('f-lideres-bl');
    if (c1.length) p.set('c1', c1.join(','));
    if (grupos.length) p.set('grupos', grupos.join(','));
    if (lideres.length) p.set('lideres', lideres.join(','));
    return p;
  }

  function dibujar(id, config) {
    // Se busca por canvas y no en `graficos`: renderEmptyChart pudo haber
    // destruido la grafica anterior sin pasar por este registro.
    const previo = Chart.getChart(id);
    if (previo) previo.destroy();
    graficos[id] = new Chart(document.getElementById(id), config);
  }

  const LEYENDA_ABAJO = { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 10 } } } };
  const EJE_Y_CERO = { y: { beginAtZero: true, ticks: { precision: 0, callback: v => FMT(v) } } };

  // ---------------------------------------------------------------------- KPIs
  function renderKpis() {
    const r = datos.resumen;
    let total, criticos, altos, mayor30, reasignados, reabiertos, exacto;

    if (!hayFiltro()) {
      const k = r.kpis || {};
      total = k.BacklogTotal ?? 0;
      criticos = k.Criticos ?? 0;
      altos = k.Altos ?? 0;
      mayor30 = k.Mayor30Dias ?? 0;
      reasignados = k.Reasignados ?? 0;
      reabiertos = k.Reabiertos ?? 0;
      exacto = true;
    } else {
      // Recalculo exacto: cada result set trae Lider y Grupo, asi que la suma
      // filtrada equivale a lo que devolveria el SP con esos filtros.
      const pr = porLiderGrupo(r.prioridad);
      total = pr.reduce((a, x) => a + (x.Total ?? 0), 0);
      criticos = pr.reduce((a, x) => a + (x.Critica ?? 0), 0);
      altos = pr.reduce((a, x) => a + (x.Alta ?? 0), 0);
      mayor30 = porLiderGrupo(r.aging).filter(x => (x.AgingSort ?? 0) >= SORT_MAS_30)
        .reduce((a, x) => a + (x.Tickets ?? 0), 0);
      reasignados = porLiderGrupo(r.reasignaciones).reduce((a, x) => a + (x.Tickets ?? 0), 0);
      reabiertos = porLiderGrupo(r.reabiertos).reduce((a, x) => a + (x.Tickets ?? 0), 0);
      exacto = true;
    }

    const corte = document.getElementById('f-corte-bl').value;
    const pie = hayFiltro() ? 'sobre lo filtrado' : (corte ? `corte ${corte}` : '');

    const tarjetas = [
      { l: 'Backlog', v: FMT(total), f: pie },
      { l: 'Criticos', v: FMT(criticos), f: `${PCT(criticos, total)} del backlog`, s: 'sr' },
      { l: 'Altos', v: FMT(altos), f: `${PCT(altos, total)} del backlog`, s: 'sa' },
      { l: '+30 dias', v: FMT(mayor30), f: `${PCT(mayor30, total)} del backlog` },
      { l: 'Reasignados', v: FMT(reasignados), f: 'cambiaron de grupo al menos una vez' },
      { l: 'Reabiertos', v: FMT(reabiertos), f: 'mas de un intento de solucion' },
    ];

    document.getElementById('kpis-bl').innerHTML = htmlTarjetasKpi(tarjetas);
  }

  // -------------------------------------------------------------------- graficas

  // El historico solo trae la dimension Lider, asi que un cross-filter por
  // grupo / prioridad / antiguedad no se puede reconstruir exacto hacia atras.
  // Se calcula que proporcion del backlog de cada lider deja pasar ese filtro
  // EN EL CORTE ACTUAL y esa proporcion se aplica a toda su serie. Devuelve
  // null cuando no hace falta escalar -sin filtros, o solo por lider-, que es
  // el unico caso en que la tendencia es exacta.
  function escalasTendencia() {
    if (filtro.grupo === null && filtro.prioridad === null && filtro.aging === null) return null;

    const pr = datos.resumen.prioridad || [];
    const base = sumaPor(pr, 'Lider', 'Total');

    // Numerador: prioridad ya filtrada por grupo, tomando la columna de la
    // prioridad elegida -o el Total si no hay prioridad en el filtro-.
    const campo = filtro.prioridad ?? 'Total';
    const num = new Map();
    for (const x of pr) {
      if (filtro.grupo !== null && x.Grupo !== filtro.grupo) continue;
      num.set(x.Lider, (num.get(x.Lider) ?? 0) + (x[campo] ?? 0));
    }

    // La antiguedad vive en otro result set -una marginal, no una tabla
    // cruzada-, asi que entra como proporcion extra por lider.
    if (filtro.aging !== null) {
      const totAg = new Map(), selAg = new Map();
      for (const x of datos.resumen.aging || []) {
        if (filtro.grupo !== null && x.Grupo !== filtro.grupo) continue;
        totAg.set(x.Lider, (totAg.get(x.Lider) ?? 0) + (x.Tickets ?? 0));
        if (x.Aging === filtro.aging) selAg.set(x.Lider, (selAg.get(x.Lider) ?? 0) + (x.Tickets ?? 0));
      }
      for (const [l, v] of num) {
        const t = totAg.get(l) ?? 0;
        num.set(l, t > 0 ? v * (selAg.get(l) ?? 0) / t : 0);
      }
    }

    const porLider = new Map();
    for (const [l, b] of base) porLider.set(l, b > 0 ? (num.get(l) ?? 0) / b : 0);

    const sumaBase = [...base.values()].reduce((a, v) => a + v, 0);
    const sumaNum = [...num.values()].reduce((a, v) => a + v, 0);
    return { porLider, global: sumaBase > 0 ? sumaNum / sumaBase : 0 };
  }

  // Aplica un factor a una serie [{Periodo, TicketsBacklog}].
  function escalarSerie(serie, factor) {
    if (factor === null || factor === undefined) return serie;
    return serie.map(p => ({ ...p, TicketsBacklog: Math.round((p.TicketsBacklog ?? 0) * factor) }));
  }

  // Texto del encabezado: que se esta viendo y si el numero es exacto.
  function pieTendencia(esc) {
    const activos = dimensionesActivas(filtro);
    if (!activos.length) return 'todos los lideres';
    const txt = activos.map(([d, v]) => ETIQUETA_DIM[d] + ': ' + v).join(' \u00b7 ');
    return esc ? txt + ' \u00b7 estimado con la proporcion del corte actual' : txt;
  }

  // Serie total del periodo. Con lideres elegidos en el multiselect se
  // reconstruye sumando sus series -el total que manda el SP puede venir sin
  // filtrar, y de todos modos asi cuadra con la grafica por lider-.
  function serieTotalVisible() {
    const elegidos = seleccionados('f-lideres-bl');
    if (!elegidos.length) return datos.historico.total || [];

    // usp_..._HistoricoPorLider topea la serie en TopLideres: si alguno de los
    // lideres elegidos no viene en ella, sumarla daria de menos. En ese caso se
    // deja el total que mando el SP, que si trae el filtro aplicado.
    const filas = datos.historico.porLider || [];
    const presentes = new Set(filas.map(x => x.Lider));
    if (!elegidos.every(l => presentes.has(l))) return datos.historico.total || [];

    const m = new Map();
    for (const x of filas) {
      if (!elegidos.includes(x.Lider)) continue;
      const d = String(x.FechaCorte).slice(0, 10);
      m.set(d, (m.get(d) ?? 0) + (x.Tickets ?? 0));
    }
    if (!m.size) return datos.historico.total || [];
    return [...m.entries()].sort().map(([Periodo, TicketsBacklog]) => ({ Periodo, TicketsBacklog }));
  }

  function renderTendenciaTotal() {
    const hint = document.getElementById('hint-tendencia-bl');
    const esc = escalasTendencia();
    let serie;
    if (filtro.lider) {
      // La serie por lider si permite reconstruir la tendencia del filtro.
      const f = (datos.historico.porLider || []).filter(x => x.Lider === filtro.lider);
      const m = new Map();
      for (const x of f) m.set(String(x.FechaCorte).slice(0, 10), x.Tickets);
      serie = [...m.entries()].sort().map(([Periodo, TicketsBacklog]) => ({ Periodo, TicketsBacklog }));
      serie = escalarSerie(serie, esc ? (esc.porLider.get(filtro.lider) ?? 0) : null);
    } else {
      serie = escalarSerie(serieTotalVisible(), esc ? esc.global : null);
    }
    hint.textContent = pieTendencia(esc);
    datos.serieVisible = serie;

    if (!serie.length) {
      renderLineaTendencia(serie);
      return renderEmptyChart('chart-tendencia-bl', hayFiltroAlguno()
        ? 'Sin backlog historico para los filtros activos.'
        : 'No hay cortes guardados en el historico para esta ventana.');
    }

    dibujar('chart-tendencia-bl', {
      type: 'line',
      data: {
        labels: serie.map(f => String(f.Periodo).slice(0, 10)),
        datasets: [{
          label: 'Backlog', data: serie.map(f => f.TicketsBacklog),
          borderColor: filtro.lider ? colorLider(filtro.lider) : Paleta.porIndice(0),
          backgroundColor: 'rgba(37,99,235,.12)', fill: true,
          borderWidth: 2, tension: .3, pointRadius: 3,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false } }, scales: EJE_Y_CERO,
      },
    });
    renderLineaTendencia(serie);
  }

  // Convierte el formato largo (FechaCorte, Lider, Tickets) en una serie por
  // lider, rellenando con 0 las fechas donde un lider no tiene filas -si no,
  // las lineas quedan desalineadas entre si-.
  function renderTendenciaLider() {
    // El multiselect de lideres ya se manda al SP, pero se vuelve a aplicar
    // aqui: es la unica forma de garantizar que la grafica siga la seleccion
    // aunque el backend -o el mock- devuelva la serie completa.
    const elegidos = seleccionados('f-lideres-bl');
    const f = (datos.historico.porLider || [])
      .filter(x => !elegidos.length || elegidos.includes(x.Lider));
    const esc = escalasTendencia();
    const fechas = [...new Set(f.map(x => String(x.FechaCorte).slice(0, 10)))].sort();
    let nombres = [...new Set(f.map(x => x.Lider))];
    // Con grupo / prioridad / antiguedad activos, los lideres que quedan en
    // cero bajo ese filtro se sacan: una linea plana en 0 solo ensucia.
    if (esc) nombres = nombres.filter(n => (esc.porLider.get(n) ?? 0) > 0);
    const mapa = new Map(f.map(x => [`${String(x.FechaCorte).slice(0,10)}|${x.Lider}`, x.Tickets]));

    const hint = document.getElementById('hint-tendencia-lider-bl');
    if (hint) {
      const pie = pieTendencia(esc);
      hint.textContent = pie === 'todos los lideres' ? 'avance de cada torre' : pie;
    }

    if (!fechas.length || !nombres.length) {
      return renderEmptyChart('chart-tendencia-lider-bl',
        'Ningun lider tiene backlog historico con los filtros activos.');
    }

    dibujar('chart-tendencia-lider-bl', {
      type: 'line',
      data: {
        labels: fechas,
        datasets: nombres.map(n => ({
          label: n,
          data: fechas.map(d => {
            const v = mapa.get(`${d}|${n}`) ?? 0;
            return esc ? Math.round(v * (esc.porLider.get(n) ?? 0)) : v;
          }),
          borderColor: colorLider(n), backgroundColor: colorLider(n),
          // La linea del lider seleccionado se engrosa y las demas se atenuan.
          borderWidth: filtro.lider === n ? 4 : (filtro.lider ? 1 : 2),
          pointRadius: filtro.lider === n ? 3 : 2,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: LEYENDA_ABAJO, scales: EJE_Y_CERO,
        onClick: (evt, els, gr) => {
          if (!els.length) return;
          alternarFiltro('lider', gr.data.datasets[els[0].datasetIndex].label);
        },
      },
    });
  }

  function renderBarrasLider() {
    const pr = porLiderGrupo(datos.resumen.prioridad, 'lider');
    const m = new Map();
    for (const x of pr) m.set(x.Lider, (m.get(x.Lider) ?? 0) + (x.Total ?? 0));
    const ent = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const etiquetas = ent.map(e => e[0]);
    const sel = bordesSeleccion(etiquetas, filtro.lider, 0);

    if (!etiquetas.length) {
      return renderEmptyChart('chart-lider-bl', 'Sin tickets en backlog para este corte y filtros.');
    }

    /* Medidas y cifra dentro las pone DashboardBarChart (assets/js/grafica.js);
       aqui solo queda lo propio de esta grafica. El color de lider es
       IDENTIDAD y sale de la posicion en `ordenLideres` -el mismo criterio que
       colorLider()-, asi que una persona lleva su color en todas las vistas.
       El borderRadius de 6 y el contorno de seleccion mandan sobre el juego
       compartido: van en `dataset`, que se aplica despues de las medidas. */
    graficos['chart-lider-bl'] = new DashboardBarChart({
      canvas: 'chart-lider-bl',
      etiquetas,
      datos: ent.map(e => e[1]),
      paleta: { orden: ordenLideres },
      formato: FMT,
      dataset: { borderColor: sel.borderColor, borderWidth: sel.borderWidth, borderRadius: 6 },
      opciones: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `Tickets: ${FMT(c.raw)}` } } },
        scales: EJE_Y_CERO,
        onClick: (evt, _e, gr) => alternarFiltro('lider', etiquetaDelClic(gr, evt)),
      },
    }).render();
  }

  function renderBarrasPrioridad() {
    const pr = porLiderGrupo(datos.resumen.prioridad);
    const etiquetas = ['Critica', 'Alta', 'Media', 'Baja'];
    const valores = [
      pr.reduce((a, x) => a + (x.Critica ?? 0), 0),
      pr.reduce((a, x) => a + (x.Alta ?? 0), 0),
      pr.reduce((a, x) => a + (x.Media ?? 0), 0),
      pr.reduce((a, x) => a + (x.Baja ?? 0), 0),
    ];
    const sel = bordesSeleccion(etiquetas, filtro.prioridad, 0);

    // No basta con que haya filas: puede haber filas con las cuatro
    // prioridades en cero, y una grafica de puros ceros no dice nada.
    if (!valores.some(v => v > 0)) {
      return renderEmptyChart('chart-prioridad-bl', 'Sin tickets en backlog para este corte y filtros.');
    }

    /* El color va en `colores`, hecho, y NO por `paleta`: la prioridad es
       severidad -Critica/Alta/Media/Baja-, no identidad, y no entra en la
       paleta categorica. Aqui manda COLOR_PRIORIDAD_SEMAFORO -rojo, naranja,
       oro, verde-, que es el juego original de esta grafica y no el de la
       escala verde. Medidas y cifra dentro las trae DashboardBarChart. */
    graficos['chart-prioridad-bl'] = new DashboardBarChart({
      canvas: 'chart-prioridad-bl',
      etiquetas,
      datos: valores,
      colores: etiquetas.map(l => COLOR_PRIORIDAD_SEMAFORO[l]),
      formato: FMT,
      /* Aire local, y SOLO aqui. Son CUATRO categorias en una tarjeta de
         .grid3 -un tercio del ancho-, asi que la ranura de cada prioridad
         anda por los 85px y el tope compartido de 44px (Barras.GRUESA) deja
         la barra en la mitad de su ranura: mas hueco que barra. Subiendo
         SOLO el tope a 72px manda otra vez el .81 de los porcentajes
         compartidos -barra en el 81% de la ranura, 19% de aire entre
         vecinas- y en un monitor ancho el nuevo tope corta antes de que la
         barra se vuelva un bloque. Los dos porcentajes NO se tocan: el
         reparto es el mismo del resto del tablero. Va en `barra:` y no en
         Barras.GRUESA justo para no engordar las demas graficas. */
      barra: { maxBarThickness: 72 },
      dataset: { borderColor: sel.borderColor, borderWidth: sel.borderWidth, borderRadius: 6 },
      opciones: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `Tickets: ${FMT(c.raw)}` } } },
        scales: EJE_Y_CERO,
        onClick: (evt, _e, gr) => alternarFiltro('prioridad', etiquetaDelClic(gr, evt)),
      },
    }).render();
  }

  /* Apilada HORIZONTAL: una fila por CUBO DE ANTIGUEDAD -de 0-1 dias arriba
     al cubo mas viejo abajo, en orden de AgingSort- y dentro de la fila un
     segmento por lider. Es la misma matriz de siempre; lo unico que cambio
     respecto a la version vertical es el eje.

     El color es IDENTIDAD DE LIDER y lo resuelve colorLider() (Paleta contra
     `ordenLideres`), asi que una persona lleva el mismo color aqui, en
     "Backlog por lider", en la matriz de abajo, en el drill-down y en el
     correo diario. Los lideres chicos se agrupan en "Otros" -mismo criterio
     que la matriz de "Resumen por antiguedad"-.

     La leyenda va ARRIBA y es la que nombra a cada lider con su color: un
     dataset ES un lider, asi que sigue siendo clicable -apagar una entrada
     saca a esa persona de todas las pilas- y envuelve sola cuando los
     nombres son largos. Por eso el nombre completo vive aqui y no en el eje:
     el eje solo lleva los rotulos cortos de los cubos.

     El clic en un segmento filtra por BUCKET de antiguedad, que es la
     CATEGORIA de la fila, no por lider. */
  function renderBarrasAging() {
    const m = construirMatrizAging(agingFiltrado('aging'));
    if (!m) {
      return renderEmptyChart('chart-aging-bl', 'Sin tickets en backlog para este corte y filtros.');
    }

    // El contorno marca la fila seleccionada. Va en cada dataset porque el
    // grosor se aplica por segmento, y asi se resalta la pila completa.
    const sel = bordesSeleccion(m.buckets, filtro.aging, 0);

    /* Aire local, y SOLO aqui. Son hasta siete filas de antiguedad en los
       260px del .lienzo -menos lo que se lleva la leyenda de arriba-, asi
       que la ranura de cada fila anda por los 30px y el juego compartido
       -.9 x .9 con tope de 44px- pegaria una fila con la siguiente. Con
       .78 x .88 la barra ocupa el 69% de su ranura, y el tope propio de 26px
       la deja compacta tambien cuando hay tres cubos y sobra alto. El radio
       lo sigue poniendo el default compartido (Barras.RADIO). Va en `barra:`
       y no en Barras.GRUESA justo para no adelgazar las demas graficas. */
    graficos['chart-aging-bl'] = new DashboardBarChart({
      canvas: 'chart-aging-bl',
      etiquetas: m.buckets,
      barra: { categoryPercentage: 0.78, barPercentage: 0.88, maxBarThickness: 26 },
      dataset: { borderColor: sel.borderColor, borderWidth: sel.borderWidth },
      datasets: m.lideres.map(l => ({
        label: l,
        data: m.buckets.map(b => m.valores.get(`${b}|${l}`) ?? 0),
        backgroundColor: colorLider(l),
      })),
      /* Apilada: la cifra de cada segmento la pone ETIQUETAS_SEGMENTO, que
         sabe de segmentos -y ya mide la caja en los dos ejes- y omite el que
         no da el ancho. El plugin compartido no sirve: sacaria la cifra
         fuera de la barra, encima del segmento vecino. */
      etiquetasDentro: false,
      plugins: [ETIQUETAS_SEGMENTO],
      opciones: {
        indexAxis: 'y',
        maintainAspectRatio: false,
        plugins: {
          /* Leyenda ARRIBA -no la LEYENDA_ABAJO compartida-: aqui es lo que
             traduce color -> persona, asi que se lee ANTES de las barras.
             `boxWidth` chico y fuente de 10 para que cinco o seis nombres
             largos quepan en dos lineas sin empujar el lienzo. */
          legend: {
            position: 'top',
            labels: { boxWidth: 12, font: { size: 10 }, padding: 8 },
          },
          tooltip: {
            callbacks: {
              label: c => `${c.dataset.label}: ${FMT(c.raw)}`,
              // El total del cubo ya lo trae construirMatrizAging: aqui solo
              // se muestra, no se vuelve a sumar.
              footer: c => `Total: ${FMT(m.totalPorBucket.get(c[0]?.label) ?? 0)}`,
            },
          },
        },
        scales: {
          // El eje numerico pasa a la horizontal: se lleva EJE_Y_CERO tal cual.
          x: { stacked: true, ...EJE_Y_CERO.y },
          // Rotulos de cubo: cortos -"16-30 dias"-, van enteros y sin saltarse
          // ninguno.
          y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false } },
        },
        onClick: (evt, _e, gr) => alternarFiltro('aging', etiquetaDelClic(gr, evt)),
      },
    }).render();
  }


  // -------------------------------------------------- drill-down Lider -> Grupo
  function renderLideres() {
    const cont = document.getElementById('tabla-lideres-bl');
    const pr = porLiderGrupo(datos.resumen.prioridad, 'lider');
    if (!pr.length) { cont.innerHTML = '<div class="vacio">Sin datos para este corte.</div>'; return; }

    // Indices auxiliares por (lider|grupo) para las columnas que viven en
    // otros result sets.
    const mas30 = new Map(), slaFuera = new Map(), slaTotal = new Map();
    for (const x of datos.resumen.aging || []) {
      if ((x.AgingSort ?? 0) < SORT_MAS_30) continue;
      const k = `${x.Lider}|${x.Grupo}`;
      mas30.set(k, (mas30.get(k) ?? 0) + (x.Tickets ?? 0));
    }
    for (const x of datos.resumen.sla || []) {
      const k = `${x.Lider}|${x.Grupo}`;
      slaTotal.set(k, (slaTotal.get(k) ?? 0) + (x.Tickets ?? 0));
      if (x.EstadoSLA === 'Fuera SLA') slaFuera.set(k, (slaFuera.get(k) ?? 0) + (x.Tickets ?? 0));
    }

    const porLider = new Map();
    for (const x of pr) {
      if (!porLider.has(x.Lider)) porLider.set(x.Lider, []);
      porLider.get(x.Lider).push(x);
    }
    const granTotal = pr.reduce((a, x) => a + (x.Total ?? 0), 0);

    const agrega = filas => {
      const t = filas.reduce((a, x) => a + (x.Total ?? 0), 0);
      const c = filas.reduce((a, x) => a + (x.Critica ?? 0), 0);
      const al = filas.reduce((a, x) => a + (x.Alta ?? 0), 0);
      const m30 = filas.reduce((a, x) => a + (mas30.get(`${x.Lider}|${x.Grupo}`) ?? 0), 0);
      const sf = filas.reduce((a, x) => a + (slaFuera.get(`${x.Lider}|${x.Grupo}`) ?? 0), 0);
      const st = filas.reduce((a, x) => a + (slaTotal.get(`${x.Lider}|${x.Grupo}`) ?? 0), 0);
      return { t, c, al, m30, pctFuera: st > 0 ? Math.round(100 * sf / st) : null };
    };

    const celdas = (a, color) => {
      const clase = a.pctFuera === null ? '' : (a.pctFuera <= 5 ? 'bv' : a.pctFuera <= 15 ? 'ba' : 'br');
      return `<td class="num">${FMT(a.t)}</td>
        <td class="num">${PCT(a.t, granTotal)} ${miniBar(granTotal > 0 ? 100 * a.t / granTotal : 0, color)}</td>
        <td class="num">${FMT(a.c)}</td><td class="num">${FMT(a.al)}</td><td class="num">${FMT(a.m30)}</td>
        <td class="num">${a.pctFuera === null ? '—' : `<span class="badge ${clase}">${a.pctFuera}%</span>`}</td>`;
    };

    const lideres = [...porLider.entries()]
      .map(([l, f]) => [l, f, agrega(f)])
      .sort((a, b) => b[2].t - a[2].t);

    let html = '';
    lideres.forEach(([lider, filasLider, agLider], i) => {
      const color = colorLider(lider);
      const sel = filtro.lider === lider ? ' fila-sel' : '';
      html += `<tr class="n1row${sel}" data-n1="${i}">
        <td><span class="swatch" style="background:${color}"></span><span class="filtrable"
          data-dim="lider" data-valor="${escapeAttr(lider)}">${escapeHtml(lider)}</span></td>
        ${celdas(agLider, color)}</tr>`;

      filasLider.slice().sort((a, b) => (b.Total ?? 0) - (a.Total ?? 0)).forEach(g => {
        const selG = filtro.grupo === g.Grupo ? ' fila-sel' : '';
        html += `<tr class="n2row${selG}" data-p1="${i}">
          <td><span class="filtrable" data-dim="grupo" data-valor="${escapeAttr(g.Grupo)}">${escapeHtml(g.Grupo)}</span></td>
          ${celdas(agrega([g]), color)}</tr>`;
      });
    });

    cont.innerHTML = `<table><thead><tr>
        <th>Lider / Grupo</th><th class="num">Tickets</th><th class="num">% del total</th>
        <th class="num">Criticos</th><th class="num">Altos</th><th class="num">+30 dias</th>
        <th class="num">% Fuera SLA</th>
      </tr></thead><tbody>${html}</tbody></table>`;

    cont.querySelectorAll('.n1row').forEach(fila => {
      fila.addEventListener('click', e => {
        if (e.target.classList.contains('filtrable')) return;
        const abierto = fila.classList.toggle('open');
        cont.querySelectorAll(`.n2row[data-p1="${fila.dataset.n1}"]`)
          .forEach(h => h.classList.toggle('show', abierto));
      });
    });
    cont.querySelectorAll('.filtrable').forEach(el => {
      el.addEventListener('click', e => { e.stopPropagation(); alternarFiltro(el.dataset.dim, el.dataset.valor); });
    });

    document.getElementById('cap-lideres-bl').innerHTML = descripcionFiltro(granTotal);
  }

  // ------------------------------------------------ matriz de antiguedad x lider
  // Mismo calculo que hace el correo en PowerShell: agrupa el result set de
  // antiguedad en una matriz bucket x lider, con los N lideres mas grandes y
  // el resto en 'Otros'.
  function construirMatrizAging(filas, topLideres = 8) {
    if (!filas.length) return null;

    const ordenBucket = new Map();
    const totalCrudo = new Map();
    for (const f of filas) {
      if (!ordenBucket.has(f.Aging)) ordenBucket.set(f.Aging, f.AgingSort);
      totalCrudo.set(f.Lider, (totalCrudo.get(f.Lider) ?? 0) + f.Tickets);
    }
    /* Los buckets van en orden real de antiguedad, no alfabetico. El criterio
       ES el AgingSort del SP, pero NO se usa a secas: el procedimiento numera
       mal el cubo mas nuevo -"menos de un dia" sale detras de un rango de
       dias que deberia ir despues-, y el orden equivocado se veia igual en la
       grafica que en la matriz de aqui abajo, porque las dos salen de esta
       funcion.

       El arreglo de fondo es el AgingSort del SP; mientras tanto manda el
       ROTULO, pasado a dias con su unidad: 07_correo_backlog.sql escribe
       "1-7 dias", "+16 dias", "+1 mes", "+2 meses"... "+1 año". Tomar solo el
       primer numero dejaba "+1 mes" y "+1 año" en 1, empatados con
       "Menos de 1 día" -que TAMBIEN trae un 1-, y el empate lo decidia el
       AgingSort malo. "Menos de..." va siempre primero (-1), sin empates.
       "Sin fecha" no es un escalon de la escalera -no se sabe si es viejo- y
       se va al final, el mismo criterio que ya sigue colorAging() al sacarlo
       de la rampa ordinal. Empates restantes: decide el AgingSort. */
    function rangoDelRotulo(etiqueta) {
      const texto = String(etiqueta);
      if (/menos\s+de/i.test(texto)) return -1;
      if (/sin\s+(fecha|dato)/i.test(texto)) return Number.MAX_SAFE_INTEGER;
      const n = texto.match(/\d+/);
      if (!n) return 0;
      const unidad = /a[nñ]o/i.test(texto) ? 365 : (/mes/i.test(texto) ? 30 : 1);
      return parseInt(n[0], 10) * unidad;
    }
    const buckets = [...ordenBucket.entries()]
      .sort((a, b) => (rangoDelRotulo(a[0]) - rangoDelRotulo(b[0])) || (a[1] - b[1]))
      .map(e => e[0]);
    const top = new Set([...totalCrudo.entries()].sort((a, b) => b[1] - a[1]).slice(0, topLideres).map(e => e[0]));

    const valores = new Map();
    const usados = [];
    for (const f of filas) {
      const l = top.has(f.Lider) ? f.Lider : 'Otros';
      if (!usados.includes(l)) usados.push(l);
      const clave = `${f.Aging}|${l}`;
      valores.set(clave, (valores.get(clave) ?? 0) + f.Tickets);
    }

    const totalPorLider = new Map(usados.map(l =>
      [l, buckets.reduce((acc, b) => acc + (valores.get(`${b}|${l}`) ?? 0), 0)]));
    const lideres = usados.filter(l => l !== 'Otros').sort((a, b) => totalPorLider.get(b) - totalPorLider.get(a));
    if (usados.includes('Otros')) lideres.push('Otros');

    const totalPorBucket = new Map(buckets.map(b =>
      [b, lideres.reduce((acc, l) => acc + (valores.get(`${b}|${l}`) ?? 0), 0)]));

    return { buckets, lideres, valores, totalPorLider, totalPorBucket };
  }

  function renderTablaAging() {
    const cont = document.getElementById('tabla-aging-bl');
    const m = construirMatrizAging(agingFiltrado());
    if (!m) { cont.innerHTML = '<div class="vacio">Sin datos para este filtro.</div>'; return; }

    const granTotal = m.lideres.reduce((a, l) => a + m.totalPorLider.get(l), 0);
    const th = m.lideres.map(l =>
      `<th class="num" style="color:${colorLider(l)}"><span class="swatch" style="background:${colorLider(l)}"></span>${escapeHtml(l)}</th>`).join('');
    const filas = m.buckets.map(b => {
      const celdas = m.lideres.map(l => {
        const v = m.valores.get(`${b}|${l}`) ?? 0;
        return `<td class="num">${v ? FMT(v) : ''}</td>`;
      }).join('');
      return `<tr><td><b>${escapeHtml(b)}</b></td>${celdas}<td class="num"><b>${FMT(m.totalPorBucket.get(b))}</b></td></tr>`;
    }).join('');
    const totales = m.lideres.map(l => {
      const v = m.totalPorLider.get(l);
      const pct = granTotal > 0 ? 100 * v / granTotal : 0;
      return `<td class="num"><b>${FMT(v)}</b><br>${miniBar(pct, colorLider(l))}</td>`;
    }).join('');

    // Esta tabla lleva fila de totales al final, por eso no se le aplica
    // hacerOrdenable(): reordenar dejaria el total en medio.
    cont.innerHTML = `<table><thead><tr><th>Antiguedad</th>${th}<th class="num">Total</th></tr></thead>`
      + `<tbody>${filas}<tr><td><b>Total</b></td>${totales}<td class="num"><b>${FMT(granTotal)}</b></td></tr></tbody></table>`;
    document.getElementById('cap-aging-bl').innerHTML = descripcionFiltro(granTotal);
  }

  // ==================================================== Tickets mas antiguos
  // Las descripciones vienen de Proactivanet con HTML pegado desde Outlook y a
  // veces con caracteres de control de Windows-1252. En un atributo title= las
  // etiquetas se verian literales, asi que se limpian antes de mostrarlas.
  const LARGO_TOOLTIP = 300;

  function limpiarDescripcion(texto) {
    if (!texto) return '';
    return String(texto)
      .replace(/<(br|\/p|\/div|\/tr)\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
      .replace(/[\x00-\x1F\x7F-\x9F]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  // Formulario de edicion de la incidencia en Proactivanet. Pide el Id interno
  // (GUID), no el codigo: ese Id lo resuelve sincronizar_ids.py contra el API y
  // lo guarda en dbo.TicketProactivanetId. Si el ticket todavia no esta en ese
  // mapeo, el endpoint manda IdProactivanet = null y el codigo se pinta como
  // texto plano, sin enlace roto.
  const URL_TICKET_PROACTIVANET =
    'https://soriana.proactivanet.com/proactivanet/servicedesk/incidents/formIncidents/formIncidents.paw?id=';

  function celdaCodigo(t) {
    const codigo = escapeHtml(t.CodigoTicket);
    if (!t.IdProactivanet) return codigo;
    const href = URL_TICKET_PROACTIVANET + encodeURIComponent(t.IdProactivanet);
    // Sin title= propio a proposito: si el enlace trajera el suyo taparia el de
    // la celda, que es el que muestra la descripcion del ticket.
    return `<a class="enlace-ticket" href="${href}" target="_blank" rel="noopener">${codigo}</a>`;
  }

  function tooltipDescripcion(texto) {
    const limpio = limpiarDescripcion(texto);
    if (!limpio) return 'Este ticket no tiene descripcion.';
    return limpio.length > LARGO_TOOLTIP ? limpio.slice(0, LARGO_TOOLTIP) + '...' : limpio;
  }

  function renderAntiguos(topPorLider = 10) {
    const cont = document.getElementById('tabla-antiguos-bl');
    const cap = document.getElementById('cap-antiguos-bl');
    const d = datos.antiguos || {};
    const meses = Math.round((d.diasMinimo ?? 0) / 30);

    // Estos tickets si traen Lider y Prioridad, asi que respetan el filtro
    // de lider y el de prioridad; el de grupo tambien viene en cada ticket.
    let tickets = (d.tickets ?? []).filter(t =>
      (filtro.lider === null || t.Lider === filtro.lider) &&
      (filtro.grupo === null || t.Grupo === filtro.grupo) &&
      (filtro.prioridad === null || t.Prioridad === filtro.prioridad));

    if (!tickets.length) {
      cap.innerHTML = descripcionFiltro(0);
      cont.innerHTML = `<div class="vacio">No hay tickets con mas de ${d.diasMinimo ?? '—'} dias en backlog para este filtro.</div>`;
      return;
    }

    const porLider = new Map();
    for (const t of tickets) {
      if (!porLider.has(t.Lider)) porLider.set(t.Lider, []);
      porLider.get(t.Lider).push(t);
    }
    // Primero el lider que mas arrastra; dentro, del mas antiguo al menos.
    const grupos = [...porLider.entries()].sort((a, b) => b[1].length - a[1].length);

    cap.innerHTML = `${FMT(tickets.length)} tickets con mas de ${d.diasMinimo} dias `
      + `<span class="suave">(${meses} meses) · se listan los ${topPorLider} mas antiguos de cada lider</span>`;

    cont.innerHTML = grupos.map(([lider, lista]) => {
      const orden = lista.slice().sort((a, b) => b.DiasBacklog - a.DiasBacklog).slice(0, topPorLider);
      const sufijo = lista.length > topPorLider ? `mostrando ${topPorLider} de ${lista.length}` : `${lista.length}`;
      const filas = orden.map(t => `<tr>
          <td class="con-hint" title="${escapeAttr(tooltipDescripcion(t.Descripcion))}">${celdaCodigo(t)}</td>
          <td class="num"><b>${FMT(t.DiasBacklog)}</b></td>
          <td class="fecha-cell">${String(t.FechaRegistro ?? '').slice(0, 10)}</td>
          <td>${escapeHtml(t.Prioridad)}</td>
          <td>${escapeHtml(t.Grupo)}</td>
          <td>${escapeHtml(t.TecnicoSegundaLinea)}</td>
          <td>${escapeHtml(t.Subestado)}</td>
          <td>${escapeHtml(String(t.Titulo ?? '').slice(0, 70))}</td>
        </tr>`).join('');
      return `<div class="grupo-lider" style="color:${colorLider(lider)}">
          <span class="swatch" style="background:${colorLider(lider)}"></span>${escapeHtml(lider)}
          <span class="conteo">${sufijo}</span></div>
        <table><thead><tr><th>Ticket</th><th class="num">Dias</th><th>Registro</th><th>Prioridad</th>
          <th>Grupo</th><th>Tecnico</th><th>Subestado</th><th>Titulo</th></tr></thead>
        <tbody>${filas}</tbody></table>`;
    }).join('');

    cont.querySelectorAll('table').forEach(hacerOrdenable);
  }

  // ------------------------------------------------------------------ variacion
  function flecha(dif) {
    if (dif > 0) return '<span class="arrow-up">&#9650;</span>';
    if (dif < 0) return '<span class="arrow-down">&#9660;</span>';
    return '<span class="arrow-eq">&#8212;</span>';
  }

  // Variacion contra el corte anterior: los dos ultimos puntos de la serie ya
  // filtrada, en vez de usp_CorreoBacklog_Comparativa -que ignora los filtros
  // y daria un delta que no cuadra con lo que se ve-.
  function renderLineaTendencia(serie) {
    const linea = document.getElementById('tendencia-linea-bl');
    const quien = filtro.lider ? ` de <b>${escapeHtml(filtro.lider)}</b>` : ' total';
    if (serie.length >= 2) {
      const actual = serie[serie.length - 1].TicketsBacklog;
      const previo = serie[serie.length - 2].TicketsBacklog;
      const dif = actual - previo;
      linea.innerHTML = `Backlog${quien}: <b>${FMT(actual)}</b> `
        + `<span class="delta">${flecha(dif)} ${FMT(Math.abs(dif))}</span> `
        + `vs. el periodo anterior (${String(serie[serie.length - 2].Periodo).slice(0, 10)}: ${FMT(previo)})`;
    } else if (serie.length === 1) {
      linea.innerHTML = `Backlog${quien}: <b>${FMT(serie[0].TicketsBacklog)}</b> (sin periodo anterior para comparar todavia)`;
    } else {
      linea.textContent = '';
    }
  }

  // ------------------------------------------------- resumen de texto del filtro
  function descripcionFiltro(n) {
    const activos = dimensionesActivas(filtro);
    if (!activos.length) return `${FMT(n)} tickets <span class="suave">· sin filtros de tablero</span>`;
    const txt = activos.map(([d, v]) => `${ETIQUETA_DIM[d]}: ${escapeHtml(v)}`).join(' · ');
    return `${FMT(n)} tickets <span class="suave">· ${txt}</span>`;
  }

  function renderTodo() {
    renderKpis();
    renderTendenciaTotal();
    renderTendenciaLider();
    renderBarrasLider();
    renderBarrasPrioridad();
    renderBarrasAging();
    renderLideres();
    renderTablaAging();
    renderAntiguos();
  }

  function sumaPor(filas, campoClave, campoValor) {
    const m = new Map();
    for (const f of filas) m.set(f[campoClave], (m.get(f[campoClave]) ?? 0) + f[campoValor]);
    return m;
  }

  async function cargarCatalogos() {
    const c = await obtenerJSON('backlog_catalogos.ashx');
    const llenar = (id, valores) => {
      document.getElementById(id).innerHTML =
        valores.map(v => `<option value="${escapeAttr(v)}">${escapeHtml(v)}</option>`).join('');
    };
    llenar('f-c1-bl', c.c1 ?? []);
    llenar('f-grupos-bl', c.grupos ?? []);
    llenar('f-lideres-bl', c.lideres ?? []);

    // Las fechas vienen de la mas reciente a la mas vieja: la primera es el
    // corte con el que abre el tablero, igual que cuando esto era un <select>.
    // El calendario se acota al primer y ultimo corte guardado, que es la
    // validacion que antes daba la propia lista de opciones.
    const fechas = (c.fechas ?? []).map(f => String(f).slice(0, 10));
    const corte = document.getElementById('f-corte-bl');
    if (fechas.length) {
      corte.min = fechas[fechas.length - 1];
      corte.max = fechas[0];
      corte.value = fechas[0];
      corte.disabled = false;
    } else {
      corte.removeAttribute('min');
      corte.removeAttribute('max');
      corte.value = '';
      corte.disabled = true;
    }

    const aviso = document.getElementById('aviso-historico-bl');
    if (!fechas.length) {
      aviso.innerHTML = '<div class="aviso">No hay ningun corte guardado en <b>dbo.CorreoBacklogSnapshot</b>. '
        + 'Corre <b>usp_CorreoBacklog_Backfill</b> y el correo diario para que se llene.</div>';
    } else if (fechas.length < 2) {
      aviso.innerHTML = '<div class="aviso">Solo hay un corte guardado, asi que las graficas de tendencia van a salir vacias. '
        + 'Corre <b>usp_CorreoBacklog_Backfill</b> para llenar el historico hacia atras.</div>';
    } else {
      aviso.innerHTML = '';
    }
  }

  /* Mismo auto-aplicado que el tablero de SLA: los cambios seguidos se agrupan
     en una peticion y la carga que deja de ser la ultima descarta su respuesta
     para no pintar datos viejos encima de los recien pedidos. */
  const ESPERA_AUTO = 250;
  let cargaProgramada = null;
  let cargaVigente = 0;

  function programarCarga() {
    clearTimeout(cargaProgramada);
    cargaProgramada = setTimeout(() => { cargaProgramada = null; cargarTodo(); }, ESPERA_AUTO);
  }

  async function cargarTodo() {
    clearTimeout(cargaProgramada);
    cargaProgramada = null;
    const miCarga = ++cargaVigente;
    estadoCargando('estado-carga-bl');
    try {
      const p = paramsFiltros();
      const qs = p.toString();
      const qsHist = new URLSearchParams(p);
      qsHist.set('dias', document.getElementById('f-dias-bl').value);
      qsHist.set('granularidad', document.getElementById('f-granularidad-bl').value);

      const [resumen, historico, antiguos] = await Promise.all([
        obtenerJSON(`backlog_resumen.ashx?${qs}`),
        obtenerJSON(`backlog_historico.ashx?${qsHist.toString()}`),
        obtenerJSON(`backlog_antiguos.ashx?${qs}`),
      ]);
      // Llego tarde: otro cambio de filtro ya lanzo una carga posterior.
      if (miCarga !== cargaVigente) return;
      datos = { resumen, historico, antiguos };

      // El orden de lideres se fija UNA vez, con el corte actual, y de ahi
      // salen los colores de todas las vistas.
      const totalPorLider = sumaPor(resumen.prioridad ?? [], 'Lider', 'Total');
      ordenLideres = [...totalPorLider.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);

      Object.keys(filtro).forEach(k => { filtro[k] = null; });
      renderTodo();
      estadoOk('estado-carga-bl');
    } catch (err) {
      if (miCarga !== cargaVigente) return;   // fallo de una carga ya superada
      estadoError('estado-carga-bl', err);
    }
  }

  async function init() {
    document.getElementById('btn-limpiar-bl').addEventListener('click', () => {
      for (const id of ['f-c1-bl', 'f-grupos-bl', 'f-lideres-bl']) {
        Array.from(document.getElementById(id).options).forEach(o => { o.selected = false; });
      }
      document.getElementById('f-dias-bl').value = '30';
      document.getElementById('f-granularidad-bl').value = 'Dia';
      cargarTodo();
    });
    // Todos los filtros del backlog recargan solos. Los multi-select emiten
    // `change` sobre el <select> original desde su capa visual, asi que los
    // seis pasan por el mismo camino, con el debounce agrupando los cambios
    // seguidos en una sola peticion.
    for (const id of ['f-corte-bl', 'f-dias-bl', 'f-granularidad-bl',
                      'f-c1-bl', 'f-grupos-bl', 'f-lideres-bl']) {
      document.getElementById(id).addEventListener('change', programarCarga);
    }
    activarSubtabs(document.querySelector('#tab-backlog .tabs').parentElement, () => redimensionar(graficos));

    try {
      await cargarCatalogos();
    } catch (err) {
      estadoError('estado-carga-bl', err);
      return;
    }
    await cargarTodo();
  }

  return { init, redimensionar: () => redimensionar(graficos) };
})();

/* =======================================================================
   4. Router de pestañas principales (carga perezosa)
   ======================================================================= */
// Experiencia / Observabilidad / Orquestacion ya no se dibujan aqui: son la
// navegacion interna del documento independiente Tablero_Experiencia.html,
// cargado en un <iframe> bajo la pestaña "Tablero". El modulo solo tiene que
// pedir la carga perezosa la primera vez.
const TableroExterno = (() => {
  // Una sola marca por carga de dashboard.html. Evita que el navegador siga
  // sirviendo de cache un Tablero_Experiencia.html viejo despues de que el
  // generador lo reemplace, sin tocar la ruta real del archivo ni cambiar la
  // URL en cada activacion de la pestaña.
  const VERSION = Date.now();

  /* La pestaña "Experiencia" del documento legacy ya la reemplazo el modulo
     nativo de experiencia/, pero Observabilidad y Orquestacion siguen viviendo
     ahi, asi que el marco se queda. Para que Experiencia no aparezca dos veces
     se esconde SOLO esa pestaña legacy, desde aqui y en el evento load del
     marco: el archivo assets/Tablero_Experiencia.html no se toca (lo regenera
     TableroExperiencia_v3.7.exe y cualquier edicion se perderia).

     Es el mismo origen -el HTML se sirve del propio sitio-, asi que
     contentDocument es accesible. Si algun dia no lo fuera (otro host, o
     file://), el try deja el marco tal cual estaba en vez de romper la
     pestaña. */
  function ocultarExperienciaLegacy(marco) {
    let doc;
    try { doc = marco.contentDocument; } catch (e) { return; }   // otro origen
    if (!doc) return;

    const boton = doc.querySelector('.mtab[data-tab="experiencia"]');
    const panel = doc.getElementById('tab-experiencia');
    // display en linea gana a la regla .maintab-content.active del legacy, asi
    // que su propio navegador de pestañas no puede volver a mostrarla.
    if (boton) boton.style.display = 'none';
    if (panel) panel.style.display = 'none';

    // Experiencia era la pestaña que abria por omision. Con ella escondida el
    // marco se veria vacio, asi que se pulsa Observabilidad: su manejador es el
    // del propio documento legacy, que ademas dispara su renderObserv().
    const eraLaActiva = !boton || boton.classList.contains('active');
    const observabilidad = doc.querySelector('.mtab[data-tab="observabilidad"]');
    if (eraLaActiva && observabilidad) observabilidad.click();

    montarDesplegables(doc);
    recolorearLegacy(doc);
  }

  /* Observabilidad y Orquestacion, que es lo que se ve de este documento, aun
     traen <select> nativos. El archivo generado no se puede tocar, pero es del
     mismo origen: basta con enlazarle la hoja del desplegable y montar sus
     <select> desde aqui. Desplegable crea los nodos con el ownerDocument del
     <select>, asi que el modulo funciona dentro del marco sin cargar su
     archivo ahi. Si el generador reemplaza el HTML, esto sigue valiendo:
     no hay ni una linea escrita en el. */
  function montarDesplegables(doc) {
    if (typeof Desplegable === 'undefined') return;
    if (!doc.getElementById('css-desplegable')) {
      const hoja = doc.createElement('link');
      hoja.id = 'css-desplegable';
      hoja.rel = 'stylesheet';
      hoja.href = new URL('assets/css/desplegable.css', location.href).href;
      doc.head.appendChild(hoja);
    }
    Desplegable.montar(doc);
  }

  /* El marco traia su propia paleta -cabecera azul marino, franja de KPI
     azul y "bien" en verde esmeralda-, que no es la del tablero. Se corrige
     desde fuera por la misma razon que los desplegables: el HTML es generado
     y no se puede editar. La hoja entra al final del <head>, asi que gana
     por orden a las reglas de su <style> sin subir especificidad.
     Solo color; ningun KPI cambia de estado ni de valor. */
  function recolorearLegacy(doc) {
    if (doc.getElementById('css-tablero-legacy')) return;
    const hoja = doc.createElement('link');
    hoja.id = 'css-tablero-legacy';
    hoja.rel = 'stylesheet';
    hoja.href = new URL('assets/css/tablero-legacy.css', location.href).href;
    doc.head.appendChild(hoja);
  }

  function init() {
    const marco = document.getElementById('iframe-tablero');
    if (!marco || marco.src) return;
    marco.addEventListener('load', () => ocultarExperienciaLegacy(marco));
    marco.src = marco.dataset.src + '?v=' + VERSION;
  }
  // El iframe se redimensiona solo con su contenedor; el documento externo
  // maneja su propio layout. No hay nada que comunicarle desde aqui.
  return { init, redimensionar: () => {} };
})();

/* ---------------------------------------------------------------------------
   Modulos embebidos: "Experiencia" y "QA".

   Los dos son lo mismo desde aqui: una carpeta con su pagina, su hoja y su
   script (experiencia/ y qa/), que sigue funcionando suelta y que ademas se
   monta dentro de una pestaña. Este bloque solo hace el montaje -traer el
   marcado, acotar la hoja e inyectar el script UNA vez, la primera vez que se
   abre la pestaña-; ninguna logica de esos tableros (KPIs, graficas, filtros,
   detalle, modales) se copia a este archivo.

   Las hojas de los dos modulos son hojas de pagina completa: resetean `*`,
   estilizan `body`, `table`, `th`, `td` y definen .card/.kpi/.grid2/.tabla...,
   el mismo vocabulario que dashboard.css pero con otros valores. Cargadas tal
   cual, la ultima en entrar repinta a la otra (el tablero perderia su .wrap de
   1500px, sus sombras y sus hovers).

   @scope (#tab-<modulo>) las deja encerradas en su pestaña sin tocar ni una
   linea de los archivos, asi que las paginas sueltas no se enteran. De paso,
   dentro del @scope las reglas de `:root` y `body` no casan con nada -html y
   body no son descendientes del contenedor-, que es justo lo que se quiere.
   Por eso qa.css declara sus variables tambien en #tab-qa, que si es la raiz
   del ambito.
   --------------------------------------------------------------------------- */

const SOPORTA_SCOPE = (() => {
  try {
    const prueba = document.createElement('style');
    prueba.textContent = '@scope (body) { :scope { color: red } }';
    document.head.appendChild(prueba);
    const ok = !!(prueba.sheet && prueba.sheet.cssRules.length);
    prueba.remove();
    return ok;
  } catch (e) { return false; }
})();

function moduloEmbebido({ nombre, base, id, pagina, hoja, guion, alVolver = () => {} }) {

  async function texto(ruta) {
    const resp = await fetch(ruta, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`${ruta} -> HTTP ${resp.status}`);
    return resp.text();
  }

  async function inyectarCss() {
    const idHoja = 'css-' + id;
    if (document.getElementById(idHoja)) return;
    let css = await texto(base + hoja);

    /* Los @keyframes salen del @scope: su nombre es global, no un selector, y
       encerrarlos no aporta nada. Fuera se comportan igual y se evita depender
       de que el navegador acepte esa anidacion. */
    const marcos = [];
    css = css.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, bloque => {
      marcos.push(bloque);
      return '';
    });

    const estilo = document.createElement('style');
    estilo.id = idHoja;
    estilo.textContent = `${marcos.join('\n')}\n@scope (#${id}) {\n${css}\n}`;
    document.head.appendChild(estilo);
  }

  async function montarMarcado(cont) {
    const doc = new DOMParser().parseFromString(await texto(base + pagina), 'text/html');

    /* Fuera <script> y <link>: DOMParser no ejecuta los primeros (hay que
       recrearlos) y de los segundos ya se encarga inyectarCss(). Con ellos se
       va tambien la copia local de Chart.js que cargan las paginas sueltas,
       que aqui sobra: dashboard.html ya trae Chart.js 4.4.4 y una segunda
       copia reemplazaria el global que usan las graficas de SLA y de Backlog.
       Los vendor siguen en su sitio para las paginas sueltas. */
    doc.querySelectorAll('script, link[rel="stylesheet"]').forEach(n => n.remove());

    /* La pagina suelta envuelve su contenido en un #tab-<modulo> propio. Aqui
       ese id ya lo lleva el contenedor de la pestaña, y dos nodos con el mismo
       id dejarian a getElementById() devolviendo el equivocado: se desarma el
       envoltorio y se conservan sus hijos. */
    const interno = doc.getElementById(id);
    if (interno) interno.replaceWith(...interno.childNodes);

    cont.append(...doc.body.childNodes);
  }

  function cargarScript(cont) {
    return new Promise((listo, fallo) => {
      const s = document.createElement('script');
      s.src = base + guion;
      s.onload = listo;
      s.onerror = () => fallo(new Error('no se pudo cargar ' + s.src));
      cont.appendChild(s);          // al final, con el marcado ya puesto
    });
  }

  // Sin @scope no hay forma de aislar la hoja sin reescribirla, asi que se cae
  // al patron que ya usa la pestaña "Tablero": la misma pagina, en un marco.
  function montarEnMarco(cont) {
    const marco = document.createElement('iframe');
    marco.className = 'tablero-externo';
    marco.title = 'Tablero de ' + nombre;
    marco.src = base + pagina;
    cont.appendChild(marco);
    console.warn(`Este navegador no soporta @scope: ${nombre} se monta en un marco.`);
  }

  function init() {
    const cont = document.getElementById(id);
    if (!cont || cont.childElementCount) return;   // ya montado

    if (!SOPORTA_SCOPE) return montarEnMarco(cont);

    cont.innerHTML = `<div class="estado" style="padding:24px">Cargando ${nombre}...</div>`;
    (async () => {
      await inyectarCss();
      cont.textContent = '';
      await montarMarcado(cont);
      // El script del modulo es un IIFE que arranca solo y pide su .ashx una vez.
      await cargarScript(cont);
    })().catch(err => {
      console.error(err);
      cont.innerHTML = `<div class="card" style="margin-top:16px">
        <h3>No se pudo montar el tablero de ${nombre}</h3>
        <p style="font-size:13px;color:#5e5e5f">${escapeHtml(err.message)} ·
        el tablero suelto sigue en <a href="${base}${pagina}">${base}${pagina}</a>.</p></div>`;
    });
  }

  /* Sus graficas nacen con la pestaña ya visible (activarTab pone la clase
     .active antes de llamar a init()), asi que al volver no hay que
     reconstruir nada: como mucho, remedir lo que quedo con el contenedor
     oculto. Cada modulo dice si necesita ese aviso. */
  return { init, redimensionar: alVolver };
}

const TableroExperiencia = moduloEmbebido({
  nombre: 'Experiencia',
  base: 'experiencia/',
  id: 'tab-experiencia',
  pagina: 'experiencia.html',
  hoja: 'experiencia.css',
  guion: 'experiencia.js',
});

/* QA: el modulo publica window.TableroQaModulo al arrancar. Mientras la
   pestaña estuvo oculta su contenedor midio cero, asi que al volver se le
   pide que remida sus graficas; los datos ya cargados se quedan como estan y
   no se repite ninguna peticion a qa.ashx. */
const TableroQa = moduloEmbebido({
  nombre: 'QA',
  base: 'qa/',
  id: 'tab-qa',
  pagina: 'qa.html',
  hoja: 'qa.css',
  guion: 'qa.js',
  alVolver: () => {
    const modulo = window.TableroQaModulo;
    if (modulo) modulo.redimensionar();
  },
});

/* =======================================================================
   Pestanas de SLA y Call Center: un solo tablero en dos vistas
   -----------------------------------------------------------------------
   El Call Center no tiene datos, filtros ni ciclo de vida propios: su
   dataset (llamadas.ashx) viaja en la misma carga de TableroSla y lo pintan
   sus mismas funciones. Al darle pestana propia hay dos cosas que resolver.

   1. Los controles. La barra de filtros y el sello de estado son de los dos
      -el rango de fechas manda sobre tickets y llamadas por igual, y el
      filtro de campanas solo mueve al Call Center-. En vez de duplicarlos,
      se MUEVEN a la pestana que se esta viendo: siguen siendo un unico
      <select> con sus mismos ids y sus mismos listeners.
   2. La carga. Abrir cualquiera de las dos pestanas por primera vez dispara
      el init() de TableroSla; la otra ya solo remide sus graficas, que
      midieron cero mientras su contenedor estuvo oculto.
   ======================================================================= */
function adoptarControlesSla(idTab) {
  const destino = document.getElementById(idTab);
  const filtros = document.getElementById('filtros-sla');
  const estado = document.getElementById('estado-carga');
  if (!destino || !filtros || !estado) return;
  destino.querySelector('.acciones-top').appendChild(estado);
  destino.querySelector('header.top').insertAdjacentElement('afterend', filtros);

  /* Los dos tableros no miden el mismo periodo largo: en SLA interesa el año
     en curso y en el Call Center el mes en curso. Como la barra es UNA y
     viaja entre las dos pestañas, el segundo boton del rango rapido se elige
     aqui, al moverla: los dos <button> ya estan en el marcado y comparten el
     listener de `#filtros-sla [data-rango]`. "7 dias" no se toca. */
  const esCallCenter = idTab === 'tab-call';
  const anio = filtros.querySelector('[data-rango="anio"]');
  const mes = filtros.querySelector('[data-rango="mes"]');
  if (anio) anio.hidden = esCallCenter;
  if (mes) mes.hidden = !esCallCenter;

  /* El SLOT es un concepto de tickets -el corte quincenal con el que se mide
     el cumplimiento-, no de llamadas: en el Call Center el control no tenia
     nada que decir. Se retira el campo entero, con su etiqueta y su resumen,
     asi que no queda ni boton vacio ni hueco reservado (dashboard.css:
     `.filtros .campo[hidden]`). En SLA sigue exactamente igual: el marcado y
     los listeners no se tocan, solo deja de mostrarse mientras la barra esta
     prestada a la otra pestaña. */
  const slot = filtros.querySelector('.campo-slot');
  if (slot) slot.hidden = esCallCenter;

  /* Campanas es la cara opuesta del SLOT: la cola de llamadas no dice nada de
     un ticket y ningun handler de SLA lee el parametro `campanas` (solo lo
     manda paramsLlamadas()). Se retira el campo entero en SLA -etiqueta y
     <select>- y vuelve en el Call Center, donde sigue siendo el mismo control
     con sus mismos ids, listeners y seleccion: viajar a SLA no la pierde. */
  const campanas = filtros.querySelector('.campo-campanas');
  if (campanas) campanas.hidden = !esCallCenter;

  /* Grupos y tecnicos: en el Call Center solo los que atienden telefono. */
  TableroSla.modoCallCenter(esCallCenter);
}

let slaIniciado = false;

function pestanaSla(idTab) {
  return {
    init() {
      adoptarControlesSla(idTab);
      if (slaIniciado) return TableroSla.redimensionar();
      slaIniciado = true;
      return TableroSla.init();
    },
    redimensionar() {
      adoptarControlesSla(idTab);
      TableroSla.redimensionar();
    },
  };
}

const MODULOS = {
  sla: pestanaSla('tab-sla'),
  backlog: TableroBacklog,
  experiencia: TableroExperiencia,
  qa: TableroQa,
  call: pestanaSla('tab-call'),
  tablero: TableroExterno,
};

const iniciado = { sla: false, backlog: false, experiencia: false, qa: false, call: false, tablero: false };

function activarTab(nombre) {
  if (!MODULOS[nombre]) nombre = 'sla';

  const idContenedor = 'tab-' + nombre;
  document.querySelectorAll('.mtab').forEach(b => b.classList.toggle('active', b.dataset.tab === nombre));
  document.querySelectorAll('.maintab-content').forEach(d => d.classList.toggle('active', d.id === idContenedor));
  // Abierto con file:// el navegador trata cada archivo como origen unico y
  // replaceState puede lanzar SecurityError, que mataria el resto de
  // activarTab. La URL con hash es una comodidad, no algo critico.
  try { history.replaceState(null, '', '#' + nombre); } catch (e) { location.hash = nombre; }

  // Solo la pestaña que se esta viendo pega a sus .ashx; la otra espera a su
  // primer clic. Al volver, las graficas ya existen y solo hay que remedirlas.
  if (!iniciado[nombre]) {
    iniciado[nombre] = true;
    MODULOS[nombre].init();
  } else {
    MODULOS[nombre].redimensionar();
  }
}

document.querySelectorAll('.mtab').forEach(btn => {
  btn.addEventListener('click', () => activarTab(btn.dataset.tab));
});

/* =======================================================================
   5. Desplegables propios (solo capa visual de los filtros)
   -----------------------------------------------------------------------
   La implementacion vive en assets/js/desplegable.js y es UNA sola para todo
   el tablero: los seis <select multiple> de SLA y Backlog, los dos de una
   opcion de Backlog y los de los modulos embebidos (Experiencia, QA), que la
   llaman desde sus propios archivos.

   Aqui no hay logica de filtrado ni llamadas a los .ashx: los <select>
   originales se quedan en el DOM con sus mismos ids, sus mismas <option> y su
   misma seleccion, y siguen disparando el mismo `change` de siempre. Los
   <input type="date"> no son desplegables y no se tocan: conservan el
   calendario nativo del navegador.
   ======================================================================= */
Desplegable.montar(document);
