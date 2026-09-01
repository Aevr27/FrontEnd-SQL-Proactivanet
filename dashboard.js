/* =========================================================================
   dashboard.js

   JavaScript del tablero. Extraido de dashboard.html, que ahora lo carga
   con <script src="dashboard.js"> en vez de llevarlo incrustado.

   Contiene el bloque grande: datos de demostracion, capa de acceso a los
   .ashx, render de KPIs, graficas y tablas de las pestanas de SLA,
   productividad, backlog y tableros extra.

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

const COLOR_PRIORIDAD = {
  'Critica': '#dc2626', 'Crítica': '#dc2626',
  'Alta': '#d97706', 'Media': '#eab308', 'Baja': '#16a34a'
};
const PALETA_CAT = ['#2563eb','#059669','#d97706','#7c3aed','#0891b2','#dc2626','#94a3b8',
                    '#db2777','#65a30d','#0d9488'];

// Semaforo de tres niveles: devuelve el sufijo de clase (.kpi.sv/.sa/.sr).
const SEM = pct => pct >= 90 ? 'sv' : (pct >= 75 ? 'sa' : 'sr');
const COLOR_SEM = { sv: '#059669', sa: '#d97706', sr: '#dc2626' };
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

function limpiarFiltro(filtro, alCambiar) {
  Object.keys(filtro).forEach(k => { filtro[k] = null; });
  alCambiar();
}

// Barra de "filtros activos": un chip por dimension, con su tache para quitarla.
function pintarChipsFiltro(contenedorId, filtro, etiquetas, alCambiar, textoVacio) {
  const cont = document.getElementById(contenedorId);
  const activos = dimensionesActivas(filtro);
  if (!activos.length) {
    cont.innerHTML = `<span class="ninguno">${textoVacio}</span>`;
    return;
  }
  cont.innerHTML = activos.map(([d, v]) =>
    `<span class="fchip"><span class="dim">${etiquetas[d]}:</span>${escapeHtml(v)}
      <span class="quitar" data-dim="${d}">&times;</span></span>`).join(' ');
  cont.querySelectorAll('.quitar').forEach(x => {
    x.addEventListener('click', () => { filtro[x.dataset.dim] = null; alCambiar(); });
  });
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
  // primero, igual que cuando responde una sola llamada.
  return filas.sort((a, b) => String(b.FechaRegistro || '').localeCompare(String(a.FechaRegistro || '')));
}

function seleccionados(id) {
  return Array.from(document.getElementById(id).selectedOptions).map(o => o.value);
}

function estadoCargando(id) { document.getElementById(id).textContent = 'Cargando...'; }
function estadoOk(id) {
  document.getElementById(id).textContent = `Actualizado ${new Date().toLocaleTimeString('es-MX')}`;
}
function estadoError(id, err) {
  const el = document.getElementById(id);
  el.textContent = `Error al cargar datos: ${err.message}`;
  el.title = err.message;
  console.error(err);
}

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
    borderColor: etiquetas.map(e => e === seleccionada ? '#0f172a' : '#fff'),
    borderWidth: etiquetas.map(e => e === seleccionada ? 3 : grosorNormal),
  };
}

// Chart.js core no trae plugin de datalabels: este dibuja la cantidad dentro
// de cada segmento de una barra apilada -un numero por color-. Los segmentos
// que no dan alto para el texto se dejan al tooltip.
const ETIQUETAS_SEGMENTO = {
  id: 'etiquetasSegmento',
  afterDatasetsDraw(chart) {
    const ctx = chart.ctx;
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
        if (Math.abs((barra.base ?? 0) - barra.y) < 14) return;
        const y = ((barra.base ?? 0) + barra.y) / 2;
        const texto = FMT(v);
        // Contorno oscuro: el mismo numero se lee sobre cualquier color de la paleta.
        ctx.strokeStyle = 'rgba(15,23,42,.65)';
        ctx.lineWidth = 3;
        ctx.strokeText(texto, barra.x, y);
        ctx.fillStyle = '#fff';
        ctx.fillText(texto, barra.x, y);
      });
    });
    ctx.restore();
  },
};

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
  ctx.fillStyle = '#94a3b8';
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
const TableroSla = (function () {
  // El SP topea el detalle en 5000 filas (@TopSeguro). Se pide el maximo
  // porque el cross-filter de las graficas se calcula sobre estas filas.
  // Bajar este numero solo reduce cobertura; no requiere tocar el backend.
  const TOPE_DETALLE = 500;

  const AZUL = '#2563eb', VERDE = '#059669', ROJO = '#dc2626', MORADO = '#7c3aed', GRIS = '#94a3b8';
  const ORDEN_AGING = ['0-1 dias', '2-3 dias', '4-7 dias', '8-15 dias', '16-30 dias', '31+ dias', 'Sin fecha'];

  const graficos = {};
  let datos = null;
  // Dimensiones de cross-filter. null = sin filtrar por esa dimension.
  const filtro = { estado: null, prioridad: null, aging: null, sla: null };

  const ETIQUETA_DIM = { estado: 'Estado', prioridad: 'Prioridad',
                         aging: 'Antiguedad', sla: 'SLA' };

  // Etiqueta de respaldo cuando el campo viene vacio. Son exactamente las
  // mismas que emite distribucion.ashx (ISNULL(NULLIF(...))), asi que una
  // rebanada agregada por el servidor y la misma rebanada recalculada sobre
  // `detalle` se llaman igual y el cross-filter por clic casa en los dos casos.
  const SIN_VALOR = { estado: 'Sin estado', prioridad: 'Sin prioridad', aging: 'Sin fecha' };

  const txt = v => String(v ?? '').trim();

  const VALOR_DIM = {
    estado:    r => txt(r.Estado) || SIN_VALOR.estado,
    prioridad: r => txt(r.Prioridad) || SIN_VALOR.prioridad,
    aging:     r => txt(r.AgingBucket) || SIN_VALOR.aging,
    sla:       r => (r.SlaVencido === true || r.SlaVencido === 1) ? 'Vencido'
                  : (r.DentroSla === true || r.DentroSla === 1) ? 'Dentro' : 'N/D',
  };

  function hayFiltro() { return dimensionesActivas(filtro).length > 0; }

  // Filas que pasan todas las dimensiones activas. `omitir` deja fuera una
  // dimension: es lo que permite que la grafica sobre la que se hizo clic
  // siga mostrando todas sus rebanadas mientras las demas se recalculan.
  function filas(omitir) {
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
    filtro[dim] = (filtro[dim] === valor) ? null : valor;
    renderTodo();
  }

  // ---------------------------------------------------------- filtros al servidor
function formatoFecha(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function hoyISO() {
  return formatoFecha(new Date());
}

  function aplicarRangoRapido(tipo) {
    const hoy = new Date();
    let inicio, fin = new Date(hoy);
    if (tipo === '7d') { inicio = new Date(hoy); inicio.setDate(inicio.getDate() - 6); }
    // "Slot": bloque rodante de 30 dias que termina hoy (mismo criterio que el
    // SLOT 0 del Tablero de Experiencia), no el mes calendario en curso. Con el
    // mes calendario, el dia 1 de cada mes el rango colapsaba a un solo dia.
    else if (tipo === 'mes') { inicio = new Date(hoy); inicio.setDate(inicio.getDate() - 29); }
    else if (tipo === 'anio') inicio = new Date(hoy.getFullYear(), 0, 1);
    document.getElementById('f-inicio').value = formatoFecha(inicio);
    document.getElementById('f-fin').value = formatoFecha(fin);
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

  // Mismo rango de fechas, pero sin el filtro de Tecnicos: es lo que alimenta
  // el ranking de personas con mas tickets cerrados.
  function paramsSoloGrupos() {
    const p = paramsFiltros();
    p.delete('tecnicos');
    return p;
  }

  async function cargarCatalogos() {
    const cat = await obtenerJSON('catalogos.ashx');
    const opciones = v => v.map(x => `<option value="${escapeAttr(x)}">${escapeHtml(x)}</option>`).join('');
    document.getElementById('f-grupos').innerHTML = opciones(cat.grupos ?? []);
    document.getElementById('f-tecnicos').innerHTML = opciones(cat.tecnicos ?? []);
  }

  // ---------------------------------------------------------------------- KPIs
  function renderKpis() {
    const cont = document.getElementById('kpis');
    const k = datos.kpis || {};
    const totalRango = k.TicketsTotales ?? 0;

    let tarjetas;
    if (!hayFiltro()) {
      // Sin cross-filter los KPIs salen del SP: son exactos sobre todo el rango.
      const cumpl = k.CumplimientoSlaPct ?? null;
      const evaluables = k.TicketsSlaEvaluable ?? 0;
      const vencidos = k.TicketsSlaVencidos ?? 0;
      tarjetas = [
        { l: 'Tickets totales', v: FMT(totalRango),
          f: `${FMT(k.TicketsAbiertos ?? 0)} abiertos · ${FMT(k.TicketsCerrados ?? 0)} cerrados` },
        { l: 'Abiertos', v: FMT(k.TicketsAbiertos ?? 0), f: `${PCT(k.TicketsAbiertos ?? 0, totalRango)} del total` },
        { l: 'Cerrados', v: FMT(k.TicketsCerrados ?? 0), f: `${PCT(k.TicketsCerrados ?? 0, totalRango)} del total` },
        { l: 'Cumplimiento SLA', v: cumpl !== null ? `${cumpl}%` : 'N/D',
          f: evaluables ? `${FMT(k.TicketsDentroSla ?? 0)} de ${FMT(evaluables)} evaluables` : 'sin SLA evaluable',
          s: cumpl !== null ? SEM(cumpl) : '' },
        { l: 'Vencidos SLA', v: FMT(vencidos),
          f: `${FMT(k.TicketsAltaPrioridad ?? 0)} de prioridad alta o critica`, s: vencidos > 0 ? 'sr' : 'sv' },
        { l: 'Horas resolucion promedio', v: k.HorasResolucionPromedio ?? 'N/D',
          f: k.HorasCicloPromedio ? `ciclo promedio ${k.HorasCicloPromedio} h` : 'solo tickets cerrados' },
        { l: 'Tecnicos activos', v: FMT(k.TecnicosActivos ?? 0), f: `${FMT(k.GruposActivos ?? 0)} grupos activos` },
        { l: 'Reasignaciones promedio', v: k.ReasignacionesPromedio ?? 'N/D', f: 'cambios de grupo por ticket' },
      ];
    } else {
      // Con cross-filter se recalculan sobre las filas cargadas. El pie lo dice
      // explicitamente para que nadie los confunda con el total del rango.
      const f = filas(null);
      const n = f.length;
      const cargadas = (datos.detalle || []).length;
      const abiertos = f.filter(r => !r.FechaFirmaCierre).length;
      const vencidos = f.filter(r => r.SlaVencido === true || r.SlaVencido === 1).length;
      const dentro = f.filter(r => r.DentroSla === true || r.DentroSla === 1).length;
      const evaluables = vencidos + dentro;
      const cumpl = evaluables > 0 ? Math.round(1000 * dentro / evaluables) / 10 : null;
      const horas = f.map(r => r.HorasResolucion).filter(h => h !== null && h !== undefined);
      const promedio = horas.length ? Math.round(100 * horas.reduce((a, b) => a + Number(b), 0) / horas.length) / 100 : null;
      const deN = `filtrado: ${FMT(n)} de ${FMT(cargadas)} cargados`;

      tarjetas = [
        { l: 'Tickets filtrados', v: FMT(n), f: deN },
        { l: 'Abiertos', v: FMT(abiertos), f: `${PCT(abiertos, n)} de lo filtrado` },
        { l: 'Cerrados', v: FMT(n - abiertos), f: `${PCT(n - abiertos, n)} de lo filtrado` },
        { l: 'Cumplimiento SLA', v: cumpl !== null ? `${cumpl}%` : 'N/D',
          f: evaluables ? `${FMT(dentro)} de ${FMT(evaluables)} evaluables` : 'sin SLA evaluable',
          s: cumpl !== null ? SEM(cumpl) : '' },
        { l: 'Vencidos SLA', v: FMT(vencidos), f: `${PCT(vencidos, n)} de lo filtrado`, s: vencidos > 0 ? 'sr' : 'sv' },
        { l: 'Horas resolucion promedio', v: promedio ?? 'N/D', f: `${FMT(horas.length)} tickets cerrados` },
        { l: 'Tecnicos', v: FMT(new Set(f.map(r => r.Tecnico).filter(Boolean)).size), f: 'en lo filtrado' },
        { l: 'Grupos', v: FMT(new Set(f.map(r => r.Grupo).filter(Boolean)).size), f: 'en lo filtrado' },
      ];
    }

    cont.innerHTML = htmlTarjetasKpi(tarjetas);
  }

  // -------------------------------------------------------------------- graficas
  function destruir(id) { if (graficos[id]) { graficos[id].destroy(); delete graficos[id]; } }

  const EJE_CONTEO = { beginAtZero: true, ticks: { precision: 0, callback: v => FMT(v) } };

  function renderTendencia() {
    destruir('tendencia');
    const hint = document.getElementById('hint-tendencia');
    let etiquetas, creados, cerrados, vencidos;

    if (!hayFiltro()) {
      // Serie exacta del SP sobre todo el rango.
      const f = datos.tendencia || [];
      etiquetas = f.map(x => x.Fecha);
      creados = f.map(x => x.TicketsCreados);
      cerrados = f.map(x => x.TicketsCerrados);
      vencidos = f.map(x => x.TicketsSlaVencidos);
      hint.textContent = 'creados vs cerrados vs vencidos';
    } else {
      // Recalculada sobre las filas filtradas, agrupando por dia de registro.
      const f = filas(null);
      const porDia = new Map();
      for (const r of f) {
        const d = String(r.FechaRegistro ?? '').slice(0, 10);
        if (!d) continue;
        if (!porDia.has(d)) porDia.set(d, { c: 0, cer: 0, ven: 0 });
        const a = porDia.get(d);
        a.c++;
        if (r.FechaFirmaCierre) a.cer++;
        if (r.SlaVencido === true || r.SlaVencido === 1) a.ven++;
      }
      const dias = [...porDia.keys()].sort();
      etiquetas = dias;
      creados = dias.map(d => porDia.get(d).c);
      cerrados = dias.map(d => porDia.get(d).cer);
      vencidos = dias.map(d => porDia.get(d).ven);
      hint.textContent = 'recalculada sobre lo filtrado';
    }

    if (!etiquetas.length) {
      return renderEmptyChart('chart-tendencia', hayFiltro()
        ? 'Ningun ticket con fecha de registro pasa los filtros activos.'
        : 'Sin tickets registrados en el rango de fechas.');
    }

    graficos.tendencia = new Chart(document.getElementById('chart-tendencia'), {
      type: 'line',
      data: {
        labels: etiquetas,
        datasets: [
          { label: 'Creados', data: creados, borderColor: AZUL,
            backgroundColor: 'rgba(37,99,235,.12)', fill: true, tension: .3, borderWidth: 2, pointRadius: 3 },
          { label: 'Cerrados', data: cerrados, borderColor: VERDE, backgroundColor: VERDE,
            tension: .3, borderWidth: 2, pointRadius: 3 },
          { label: 'Vencidos SLA', data: vencidos, borderColor: ROJO, backgroundColor: ROJO,
            tension: .3, borderWidth: 2, pointRadius: 3 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { y: EJE_CONTEO }
      }
    });
  }

  function renderProductividad() {
    destruir('productividad');
    let etiquetas, totales, cerrados;

    if (!hayFiltro()) {
      const top = (datos.productividad || []).slice(0, 15);
      etiquetas = top.map(x => x.Tecnico);
      totales = top.map(x => x.TicketsTotales);
      cerrados = top.map(x => x.TicketsCerrados);
    } else {
      const f = filas(null);
      const m = new Map();
      for (const r of f) {
        const t = r.Tecnico || '(sin tecnico)';
        if (!m.has(t)) m.set(t, { tot: 0, cer: 0 });
        const a = m.get(t);
        a.tot++;
        if (r.FechaFirmaCierre) a.cer++;
      }
      const top = [...m.entries()].sort((a, b) => b[1].tot - a[1].tot).slice(0, 15);
      etiquetas = top.map(e => e[0]);
      totales = top.map(e => e[1].tot);
      cerrados = top.map(e => e[1].cer);
    }

    if (!etiquetas.length) {
      return renderEmptyChart('chart-productividad', hayFiltro()
        ? 'Ningun tecnico tiene tickets con los filtros activos.'
        : 'Sin tickets asignados en el rango de fechas.');
    }

    graficos.productividad = new Chart(document.getElementById('chart-productividad'), {
      type: 'bar',
      data: {
        labels: etiquetas,
        datasets: [
          { label: 'Totales', data: totales, backgroundColor: AZUL, borderRadius: 5 },
          { label: 'Cerrados', data: cerrados, backgroundColor: VERDE, borderRadius: 5 },
        ]
      },
      options: {
        indexAxis: 'y', responsive: true, maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
        scales: { x: EJE_CONTEO }
      }
    });
  }

  // Dona de estado. Se calcula omitiendo su propia dimension para que al
  // seleccionar un estado sigan viendose los demas.
  function renderEstado() {
    destruir('estado');
    const ent = entradasDim('estado', null);
    const etiquetas = ent.map(e => e[0]);
    const valores = ent.map(e => e[1]);
    const colores = etiquetas.map((_, i) => PALETA_CAT[i % PALETA_CAT.length]);
    const sel = bordesSeleccion(etiquetas, filtro.estado, 2);

    if (!etiquetas.length) {
      document.getElementById('legend-estado').innerHTML = '';
      return renderEmptyChart('chart-estado', 'Ningun ticket pasa los filtros activos.');
    }

    graficos.estado = new Chart(document.getElementById('chart-estado'), {
      type: 'doughnut',
      data: { labels: etiquetas, datasets: [{ data: valores, backgroundColor: colores,
        borderColor: sel.borderColor, borderWidth: sel.borderWidth }] },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '58%',
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => `${c.label}: ${FMT(c.raw)}` } } },
        onClick: (evt, _els, gr) => alternarFiltro('estado', etiquetaDelClic(gr, evt)),
      }
    });

    document.getElementById('legend-estado').innerHTML = etiquetas.map((l, i) =>
      `<span data-valor="${escapeAttr(l)}" class="${filtro.estado && filtro.estado !== l ? 'apagado' : ''}">
         <i style="background:${colores[i]}"></i>${escapeHtml(l)}: ${FMT(valores[i])}</span>`).join('');
    document.querySelectorAll('#legend-estado span').forEach(s => {
      s.addEventListener('click', () => alternarFiltro('estado', s.dataset.valor));
    });
  }

  function renderBarraDim(idCanvas, idGrafico, dim, orden, colorFn, mensajeVacio) {
    destruir(idGrafico);
    const ent = entradasDim(dim, orden);
    const etiquetas = ent.map(e => e[0]);
    const valores = ent.map(e => e[1]);
    const colores = etiquetas.map((l, i) => colorFn(l, i));
    const sel = bordesSeleccion(etiquetas, filtro[dim], 0);

    if (!etiquetas.length) return renderEmptyChart(idCanvas, mensajeVacio);

    graficos[idGrafico] = new Chart(document.getElementById(idCanvas), {
      type: 'bar',
      data: { labels: etiquetas, datasets: [{ data: valores, backgroundColor: colores,
        borderColor: sel.borderColor, borderWidth: sel.borderWidth, borderRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: c => `Tickets: ${FMT(c.raw)}` } } },
        scales: { y: EJE_CONTEO },
        onClick: (evt, _els, gr) => alternarFiltro(dim, etiquetaDelClic(gr, evt)),
      }
    });
  }

  // ------------------------------------------- personas con mas tickets cerrados
  // Ranking independiente del cross-filter: se pide aparte a productividad.ashx
  // con el rango de fechas y SOLO el filtro de Grupos, asi que ni el filtro de
  // Tecnicos ni los filtros por clic del tablero lo mueven.
  const TOPE_CERRADOS = 10;

  function descripcionTopCerrados(totalCerrados, personas, mostradas) {
    const g = seleccionados('f-grupos');
    const txt = g.length ? `Grupos: ${escapeHtml(g.join(' · '))}` : 'todos los grupos';
    if (!personas) return `0 tickets cerrados <span class="suave">· ${txt}</span>`;
    const corte = mostradas < personas
      ? ` · top ${mostradas} de ${FMT(personas)} personas` : '';
    return `${FMT(totalCerrados)} tickets cerrados <span class="suave">· ${txt}${corte}</span>`;
  }

  function renderTopCerrados() {
    const cont = document.getElementById('tabla-top-cerrados');
    const cap = document.getElementById('cap-top-cerrados');
    const ranking = (datos.topCerrados || [])
      .map(x => ({
        tecnico: x.Tecnico || '(sin tecnico)',
        grupo: x.Grupo || '',
        cerrados: Number(x.TicketsCerrados) || 0,
        totales: Number(x.TicketsTotales) || 0,
      }))
      .filter(x => x.cerrados > 0)
      .sort((a, b) => b.cerrados - a.cerrados);

    if (!ranking.length) {
      cont.innerHTML = '<div class="vacio">Sin tickets cerrados para este rango y grupos.</div>';
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
          ${miniBar(tope > 0 ? 100 * x.cerrados / tope : 0, VERDE)}</td>
        <td class="num">${FMT(x.totales)}</td>
        <td class="num">${PCT(x.cerrados, x.totales)}</td>
        <td class="num">${PCT(x.cerrados, totalCerrados)}</td>
      </tr>`).join('');

    cont.innerHTML = `<table><thead><tr>
        <th class="num">#</th><th>Persona</th><th>Grupo</th>
        <th class="num">Tickets cerrados</th><th class="num">Tickets totales</th>
        <th class="num">% cerrados</th><th class="num">% del total cerrado</th>
      </tr></thead><tbody>${filasHtml}</tbody></table>`;
    hacerOrdenable(cont.querySelector('table'));

    cap.innerHTML = descripcionTopCerrados(totalCerrados, ranking.length, visibles.length);
  }

  // ------------------------------------------------------ barra de filtros activos
  function renderChips() {
    pintarChipsFiltro('chips-filtro', filtro, ETIQUETA_DIM, renderTodo,
      'ninguno · clic en una grafica para filtrar');
  }

  function resetFiltros() { limpiarFiltro(filtro, renderTodo); }

  function renderTodo() {
    renderKpis();
    renderTendencia();
    renderProductividad();
    renderEstado();
    renderBarraDim('chart-prioridad', 'prioridad', 'prioridad',
      null, l => COLOR_PRIORIDAD[l] ?? GRIS, 'Ningun ticket pasa los filtros activos.');
    renderBarraDim('chart-aging', 'aging', 'aging',
      ORDEN_AGING, () => MORADO, 'Ningun ticket pasa los filtros activos.');
    renderTopCerrados();
    renderChips();
  }

  async function cargarTodo() {
    estadoCargando('estado-carga');
    try {
      const qs = paramsFiltros().toString();
      const qsGrupos = paramsSoloGrupos().toString();
      const [kpis, tendencia, productividad, distribucion, detalle, topCerrados] = await Promise.all([
        obtenerJSON(`kpis.ashx?${qs}`),
        obtenerJSON(`tendencia.ashx?${qs}`),
        obtenerJSON(`productividad.ashx?${qs}`),
        obtenerJSON(`distribucion.ashx?${qs}`),
        obtenerDetalle(paramsFiltros(), TOPE_DETALLE),
        obtenerJSON(`productividad.ashx?${qsGrupos}`),
      ]);
      datos = { kpis, tendencia, productividad, distribucion, detalle, topCerrados };
      // Cambiar el rango invalida cualquier seleccion previa del tablero.
      Object.keys(filtro).forEach(k => { filtro[k] = null; });
      renderTodo();
      estadoOk('estado-carga');
    } catch (err) {
      estadoError('estado-carga', err);
    }
  }

  async function init() {
    document.querySelectorAll('#tab-sla [data-rango]').forEach(btn => {
      btn.addEventListener('click', () => aplicarRangoRapido(btn.dataset.rango));
    });
    document.getElementById('btn-aplicar').addEventListener('click', cargarTodo);
    document.getElementById('btn-limpiar').addEventListener('click', () => {
      document.getElementById('f-grupos').selectedIndex = -1;
      document.getElementById('f-tecnicos').selectedIndex = -1;
      // "Limpiar" tambien devuelve el rango a hoy (24 hrs): es la unica via a
      // ese rango desde que se quito el boton "24 hrs" del rango rapido.
      document.getElementById('f-inicio').value = hoyISO();
      document.getElementById('f-fin').value = hoyISO();
      cargarTodo();
    });
    document.getElementById('btn-reset-filtros').addEventListener('click', resetFiltros);

    const inicioMes = new Date();
    inicioMes.setDate(1);
    document.getElementById('f-inicio').value = formatoFecha(inicioMes);
    document.getElementById('f-fin').value = hoyISO();

    try {
      await cargarCatalogos();
    } catch (err) {
      estadoError('estado-carga', err);
      return;
    }
    await cargarTodo();
  }

  return { init, redimensionar: () => redimensionar(graficos) };
})();

/* =======================================================================
   3. Tablero de Backlog
   ======================================================================= */
const TableroBacklog = (function () {
  // Misma paleta que usa el correo, en el mismo orden: un lider conserva su
  // color entre el correo, la grafica apilada y la tabla de resumen.
  const PALETA = ['#2563eb','#dc2626','#059669','#d97706','#7c3aed','#0891b2','#db2777','#6b7280'];
  // AgingSort >= 5 es exactamente "mas de 30 dias" (ver 07_correo_backlog.sql).
  const SORT_MAS_30 = 5;

  const graficos = {};
  let datos = null;
  let ordenLideres = [];
  const filtro = { lider: null, grupo: null, prioridad: null, aging: null };
  const ETIQUETA_DIM = { lider: 'Lider', grupo: 'Grupo', prioridad: 'Prioridad', aging: 'Antiguedad' };

  function colorLider(nombre) {
    const i = ordenLideres.indexOf(nombre);
    return i >= 0 ? PALETA[i % PALETA.length] : '#6b7280';
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
          borderColor: filtro.lider ? colorLider(filtro.lider) : PALETA[0],
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

    dibujar('chart-lider-bl', {
      type: 'bar',
      data: { labels: etiquetas, datasets: [{ data: ent.map(e => e[1]),
        backgroundColor: etiquetas.map(colorLider),
        borderColor: sel.borderColor, borderWidth: sel.borderWidth, borderRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `Tickets: ${FMT(c.raw)}` } } },
        scales: EJE_Y_CERO,
        onClick: (evt, _e, gr) => alternarFiltro('lider', etiquetaDelClic(gr, evt)),
      },
    });
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

    dibujar('chart-prioridad-bl', {
      type: 'bar',
      data: { labels: etiquetas, datasets: [{ data: valores,
        backgroundColor: etiquetas.map(l => COLOR_PRIORIDAD[l]),
        borderColor: sel.borderColor, borderWidth: sel.borderWidth, borderRadius: 6 }] },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `Tickets: ${FMT(c.raw)}` } } },
        scales: EJE_Y_CERO,
        onClick: (evt, _e, gr) => alternarFiltro('prioridad', etiquetaDelClic(gr, evt)),
      },
    });
  }

  // Apilada por lider: dentro de cada barra de antiguedad, un color por lider.
  // Es el mismo color que ese lider tiene en el resto de graficas, en las
  // tablas de abajo y en el correo diario, asi que se puede seguir a una
  // persona de una vista a otra. Los lideres chicos se agrupan en "Otros"
  // -mismo criterio que la matriz de "Resumen por antiguedad"-.
  // El clic sigue filtrando por bucket de antiguedad, no por lider.
  function renderBarrasAging() {
    const m = construirMatrizAging(agingFiltrado('aging'));
    if (!m) {
      return renderEmptyChart('chart-aging-bl', 'Sin tickets en backlog para este corte y filtros.');
    }

    // El contorno marca la barra seleccionada. Va en cada dataset porque el
    // grosor se aplica por segmento, y asi se resalta la columna completa.
    const sel = bordesSeleccion(m.buckets, filtro.aging, 0);

    dibujar('chart-aging-bl', {
      type: 'bar',
      data: {
        labels: m.buckets,
        datasets: m.lideres.map(l => ({
          label: l,
          data: m.buckets.map(b => m.valores.get(`${b}|${l}`) ?? 0),
          backgroundColor: colorLider(l),
          borderColor: sel.borderColor,
          borderWidth: sel.borderWidth,
        })),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          ...LEYENDA_ABAJO,
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${FMT(c.raw)}` } },
        },
        scales: { x: { stacked: true }, y: { stacked: true, ...EJE_Y_CERO.y } },
        onClick: (evt, _e, gr) => alternarFiltro('aging', etiquetaDelClic(gr, evt)),
      },
      plugins: [ETIQUETAS_SEGMENTO],
    });
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
    // Los buckets van en orden real de antiguedad (AgingSort), no alfabetico.
    const buckets = [...ordenBucket.entries()].sort((a, b) => a[1] - b[1]).map(e => e[0]);
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

  // ------------------------------------------------------ barra de filtros activos
  function renderChips() {
    pintarChipsFiltro('chips-filtro-bl', filtro, ETIQUETA_DIM, renderTodo,
      'ninguno · clic en una grafica o en un lider para filtrar');
  }

  function resetFiltros() { limpiarFiltro(filtro, renderTodo); }

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
    renderChips();
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

    // Las fechas vienen de la mas reciente a la mas vieja: la primera queda
    // seleccionada, que es el corte con el que abre el tablero.
    const fechas = (c.fechas ?? []).map(f => String(f).slice(0, 10));
    document.getElementById('f-corte-bl').innerHTML =
      fechas.map(f => `<option value="${f}">${f}</option>`).join('');

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

  async function cargarTodo() {
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
      datos = { resumen, historico, antiguos };

      // El orden de lideres se fija UNA vez, con el corte actual, y de ahi
      // salen los colores de todas las vistas.
      const totalPorLider = sumaPor(resumen.prioridad ?? [], 'Lider', 'Total');
      ordenLideres = [...totalPorLider.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]);

      Object.keys(filtro).forEach(k => { filtro[k] = null; });
      renderTodo();
      estadoOk('estado-carga-bl');
    } catch (err) {
      estadoError('estado-carga-bl', err);
    }
  }

  async function init() {
    document.getElementById('btn-aplicar-bl').addEventListener('click', cargarTodo);
    document.getElementById('btn-limpiar-bl').addEventListener('click', () => {
      for (const id of ['f-c1-bl', 'f-grupos-bl', 'f-lideres-bl']) {
        Array.from(document.getElementById(id).options).forEach(o => { o.selected = false; });
      }
      document.getElementById('f-dias-bl').value = '30';
      document.getElementById('f-granularidad-bl').value = 'Dia';
      cargarTodo();
    });
    // Cambiar el corte o la ventana recarga de inmediato: son de un solo clic y
    // esperar a "Aplicar filtros" se siente roto.
    for (const id of ['f-corte-bl', 'f-dias-bl', 'f-granularidad-bl']) {
      document.getElementById(id).addEventListener('change', cargarTodo);
    }
    document.getElementById('btn-reset-filtros-bl').addEventListener('click', resetFiltros);
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

  function init() {
    const marco = document.getElementById('iframe-tablero');
    if (!marco || marco.src) return;
    marco.src = marco.dataset.src + '?v=' + VERSION;
  }
  // El iframe se redimensiona solo con su contenedor; el documento externo
  // maneja su propio layout. No hay nada que comunicarle desde aqui.
  return { init, redimensionar: () => {} };
})();

const MODULOS = {
  sla: TableroSla,
  backlog: TableroBacklog,
  tablero: TableroExterno,
};

const iniciado = { sla: false, backlog: false, tablero: false };

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
   5. Multi-select propio (solo capa visual de los filtros de SLA y Backlog)
   -----------------------------------------------------------------------
   No toca la logica de filtrado ni las llamadas a los .ashx: el
   <select multiple> original se queda en el DOM con su mismo id, sus mismas
   <option> y su misma seleccion. Este modulo solo dibuja un desplegable con
   opciones encima -clic simple para marcar o desmarcar, palomita a la derecha-
   y copia los cambios en las dos direcciones.
   ======================================================================= */
(() => {
  const IDS = ['f-grupos', 'f-tecnicos', 'f-c1-bl', 'f-grupos-bl', 'f-lideres-bl'];
  const controles = [];

  function crear(select) {
    const envoltura = document.createElement('div');
    envoltura.className = 'ms';
    select.parentNode.insertBefore(envoltura, select);
    envoltura.appendChild(select);

    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'ms-boton';
    boton.setAttribute('aria-haspopup', 'listbox');
    boton.setAttribute('aria-expanded', 'false');
    const texto = document.createElement('span');
    texto.className = 'ms-texto';
    const conteo = document.createElement('span');
    conteo.className = 'ms-conteo';
    boton.append(texto, conteo);

    const panel = document.createElement('div');
    panel.className = 'ms-panel';
    const busca = document.createElement('input');
    busca.type = 'search';
    busca.className = 'ms-busca';
    busca.placeholder = 'Buscar...';
    busca.setAttribute('aria-label', 'Buscar opciones');
    const acciones = document.createElement('div');
    acciones.className = 'ms-acciones';
    const btnTodos = document.createElement('button');
    btnTodos.type = 'button';
    btnTodos.textContent = 'Seleccionar todo';
    const btnNinguno = document.createElement('button');
    btnNinguno.type = 'button';
    btnNinguno.textContent = 'Limpiar';
    acciones.append(btnTodos, btnNinguno);
    const lista = document.createElement('ul');
    lista.className = 'ms-lista';
    lista.setAttribute('role', 'listbox');
    lista.setAttribute('aria-multiselectable', 'true');
    panel.append(busca, acciones, lista);

    envoltura.append(boton, panel);

    const etiqueta = document.querySelector(`label[for="${select.id}"]`);
    const nombre = (etiqueta ? etiqueta.textContent : '').replace(/\s*\(.*\)\s*$/, '').trim() || 'opciones';
    const vacio = `Todos (${nombre.toLowerCase()})`;

    // Una casilla por <option>. Se reconstruye cuando el catalogo llega.
    function construir() {
      lista.textContent = '';
      const opciones = Array.from(select.options);
      if (!opciones.length) {
        const aviso = document.createElement('li');
        aviso.className = 'ms-vacio';
        aviso.textContent = 'Sin opciones';
        lista.appendChild(aviso);
      }
      for (const opcion of opciones) {
        const fila = document.createElement('li');
        const etq = document.createElement('label');
        etq.className = 'ms-opcion';
        etq.setAttribute('role', 'option');
        const caja = document.createElement('input');
        caja.type = 'checkbox';
        caja.checked = opcion.selected;
        const txt = document.createElement('span');
        txt.textContent = opcion.text;
        etq.append(caja, txt);
        fila.appendChild(etq);
        lista.appendChild(fila);

        caja.addEventListener('change', () => {
          opcion.selected = caja.checked;
          pintar();
          select.dispatchEvent(new Event('change', { bubbles: true }));
        });
      }
      filtrarLista();
      pintar();
    }

    // Refleja en el control lo que diga el <select>, venga de donde venga.
    function pintar() {
      const marcadas = Array.from(select.selectedOptions);
      Array.from(lista.querySelectorAll('.ms-opcion')).forEach((etq, i) => {
        const opcion = select.options[i];
        if (!opcion) return;
        etq.querySelector('input').checked = opcion.selected;
        etq.classList.toggle('marcada', opcion.selected);
      });
      if (!marcadas.length) {
        texto.textContent = vacio;
        boton.classList.add('vacio');
        conteo.style.display = 'none';
        conteo.textContent = '';
      } else {
        texto.textContent = marcadas.map(o => o.text).join(', ');
        boton.classList.remove('vacio');
        conteo.style.display = '';
        conteo.textContent = String(marcadas.length);
      }
      boton.title = marcadas.length ? texto.textContent : '';
    }

    function filtrarLista() {
      const q = busca.value.trim().toLowerCase();
      Array.from(lista.children).forEach(li => {
        const etq = li.querySelector('.ms-opcion');
        if (!etq) return;
        li.style.display = (!q || etq.textContent.toLowerCase().includes(q)) ? '' : 'none';
      });
    }

    function marcarVisibles(valor) {
      Array.from(lista.children).forEach((li, i) => {
        if (li.style.display === 'none') return;
        const opcion = select.options[i];
        if (opcion) opcion.selected = valor;
      });
      pintar();
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function abrir() {
      cerrarTodos(envoltura);
      envoltura.classList.add('abierto');
      boton.setAttribute('aria-expanded', 'true');
      busca.focus();
    }
    function cerrar() {
      envoltura.classList.remove('abierto');
      boton.setAttribute('aria-expanded', 'false');
    }

    boton.addEventListener('click', () => {
      if (envoltura.classList.contains('abierto')) cerrar(); else abrir();
    });
    busca.addEventListener('input', filtrarLista);
    btnTodos.addEventListener('click', () => marcarVisibles(true));
    btnNinguno.addEventListener('click', () => marcarVisibles(false));
    envoltura.addEventListener('keydown', e => {
      if (e.key === 'Escape' && envoltura.classList.contains('abierto')) {
        e.stopPropagation();
        cerrar();
        boton.focus();
      }
    });

    // El catalogo se carga despues (innerHTML del <select>): hay que redibujar.
    new MutationObserver(construir).observe(select, { childList: true });
    // Cambios hechos por codigo ajeno que si avisan.
    select.addEventListener('change', pintar);

    construir();
    return { envoltura, cerrar, pintar };
  }

  function cerrarTodos(excepto) {
    for (const c of controles) if (c.envoltura !== excepto) c.cerrar();
  }

  for (const id of IDS) {
    const select = document.getElementById(id);
    if (select) controles.push(crear(select));
  }

  document.addEventListener('click', e => {
    if (!e.target.closest('.ms')) cerrarTodos(null);
  });

  // "Limpiar" de los dos paneles de filtros deselecciona por propiedad
  // (selectedIndex = -1 / option.selected = false) y no dispara ningun
  // evento. Las pestañas se inician tarde, asi que no se puede depender del
  // orden de los listeners: se repinta en el siguiente turno, cuando el
  // handler propio del boton ya corrio.
  for (const idBoton of ['btn-limpiar', 'btn-limpiar-bl']) {
    const limpiar = document.getElementById(idBoton);
    if (!limpiar) continue;
    limpiar.addEventListener('click', () => {
      setTimeout(() => controles.forEach(c => c.pintar()), 0);
    });
  }
})();
