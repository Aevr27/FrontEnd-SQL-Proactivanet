/* =========================================================================
   admin.js — consola de administracion (SOLO VISUAL)

   Lo que este archivo NO hace, a proposito:
     - no ejecuta PowerShell ni ningun proceso del sistema;
     - no abre SMTP ni manda correo;
     - no llama a ningun handler .ashx ni toca la base de datos;
     - no hace fetch() a nada, ni de lectura;
     - no muestra direcciones de correo reales (solo el conteo).

   Todo lo que se ve en pantalla sale de las constantes de este archivo y de
   estado guardado en memoria. Cada tarjeta lleva su propio objeto de estado,
   asi que tocar una no altera a las otras.

   Cuando exista la operacion real del lado del servidor, el unico punto a
   cambiar es prepararTrabajo(): ahi entraria la llamada al endpoint
   controlado que dispara el proceso y devuelve el resumen a revisar. El
   boton ENVIAR quedaria como la confirmacion explicita de ese flujo.
   ========================================================================= */

'use strict';

/* -------------------------------------------------------------------------
   Los tres flujos de correo.

   `script` es el nombre del .ps1 correspondiente, cuando se conoce. El de
   Servicios todavia no existe en este repositorio: se deja vacio a
   proposito, sin inventar nombres.

   Servicios lleva `destacado: true`: se pinta como tarjeta grande a lo ancho
   de la seccion y con controles propios (seleccion de servicios y fecha).
   ------------------------------------------------------------------------- */
var TRABAJOS_CORREO = [
  {
    id: 'qa',
    icono: '🧪',
    titulo: 'Correo QA',
    descripcion: 'Reporte de calidad del periodo con sus graficas y adjuntos.',
    script: 'Enviar_CorreoQA.ps1',
    adjuntos: 3,
    destinatarios: 4
  },
  {
    id: 'backlog',
    icono: '📥',
    titulo: 'Correo Backlog',
    descripcion: 'Detalle diario de incidentes y requerimientos en backlog.',
    script: 'Enviar_CorreoBacklog.ps1',
    adjuntos: 2,
    destinatarios: 2
  },
  {
    id: 'servicios',
    icono: '🧩',
    titulo: 'Servicios',
    descripcion: 'Reporte por servicio para la fecha indicada, con sus adjuntos.',
    script: '',
    adjuntos: 0,
    destinatarios: 3,
    destacado: true
  }
];

/* Servicios disponibles en el selector. Lista de marcador de posicion: el
   script real de Servicios todavia no esta en este repositorio. Para agregar
   uno nuevo basta con anadir una entrada aqui; la casilla se pinta sola. */
var SERVICIOS_DISPONIBLES = [
  { id: 'aws',   nombre: 'AWS',   pordefecto: true  },
  { id: 'pu',    nombre: 'PU',    pordefecto: true  },
  { id: 'fenix', nombre: 'Fenix', pordefecto: true  },
  { id: 'otro',  nombre: 'Otro',  pordefecto: false }
];

/* Las cuatro utilidades. Ninguna esta conectada: todas abren el mismo aviso. */
var HERRAMIENTAS = [
  {
    id: 'diagnostico',
    icono: '🔌',
    titulo: 'Diagnostico de conexion',
    descripcion: 'Comprobar el estado de la conexion con SQL Server.',
    estado: 'No habilitado',
    accion: 'Ejecutar diagnostico'
  },
  {
    id: 'base-datos',
    icono: '🗄️',
    titulo: 'Base de datos',
    descripcion: 'Ver el estado de las cargas y los cortes guardados.',
    estado: 'No habilitado',
    accion: 'Abrir'
  },
  {
    id: 'reporte',
    icono: '📄',
    titulo: 'Generar reporte',
    descripcion: 'Producir un reporte fuera del calendario habitual.',
    estado: 'No habilitado',
    accion: 'Generar'
  },
  {
    id: 'configuracion',
    icono: '⚙️',
    titulo: 'Configuracion',
    descripcion: 'Parametros de la consola y de los envios programados.',
    estado: 'No habilitado',
    accion: 'Configurar'
  }
];

/* Etiquetas de estado de una tarjeta de correo. */
var ETIQUETA_ESTADO = {
  inicial:  'Sin preparar',
  cargando: 'Preparando datos...',
  listo:    'Datos listos ✅',
  revision: 'En revision ✅'
};

/* Estado por tarjeta. Independiente: una clave por id de trabajo. */
var estados = {};

/* ---- Utilidades ------------------------------------------------------- */

/* Escapa texto antes de meterlo en el HTML de las plantillas. */
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function ddmmaaaa(d) {
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear();
}

/* aaaa-mm-dd en hora local (el valor que entiende <input type="date">). */
function isoLocal(d) {
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* Fecha automatica del reporte: el dia natural anterior al de hoy, tomado
   del reloj local del navegador. Nada codificado a mano. */
function fechaAutomatica() {
  var hoy = new Date();
  return new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
}

/* Convierte aaaa-mm-dd a Date local sin pasar por UTC (evita el corrimiento
   de un dia que produce new Date('2026-08-30')). */
function desdeIso(iso) {
  var t = String(iso || '').split('-');
  if (t.length !== 3) { return fechaAutomatica(); }
  return new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
}

/* Periodo mostrado en la revision: los ultimos 14 dias hasta hoy. Es solo
   texto para la vista previa; no se consulta nada con estas fechas. */
function periodoTexto() {
  var fin = new Date();
  var ini = new Date(fin.getTime() - 14 * 24 * 60 * 60 * 1000);
  return ddmmaaaa(ini) + ' → ' + ddmmaaaa(fin);
}

/* ---- Estado de Servicios ---------------------------------------------- */

function servSeleccionados(e) {
  return SERVICIOS_DISPONIBLES.filter(function (s) {
    return e.seleccion.indexOf(s.id) !== -1;
  });
}

function servFechaIso(e) {
  return e.modoFecha === 'manual' ? e.fechaManual : isoLocal(fechaAutomatica());
}

function servFechaTexto(e) {
  return ddmmaaaa(desdeIso(servFechaIso(e)));
}

/* ---- Pintado ---------------------------------------------------------- */

function bloqueCabecera(t) {
  return '<div class="job-cab">' +
      '<div class="job-icono" aria-hidden="true">' + esc(t.icono) + '</div>' +
      '<div class="job-tit">' +
        '<h3>' + esc(t.titulo) + '</h3>' +
        '<p>' + esc(t.descripcion) + '</p>' +
      '</div>' +
    '</div>';
}

function bloqueEstado(t) {
  var e = estados[t.id];
  return '<div class="job-estado">' +
      '<span class="job-punto" aria-hidden="true"></span>' +
      '<span data-rol="etiqueta">' + esc(ETIQUETA_ESTADO[e.fase]) + '</span>' +
      '<span class="job-script" title="' + esc(t.script || 'script por definir') + '">' +
        esc(t.script || 'script por definir') +
      '</span>' +
    '</div>';
}

function bloquePie(t) {
  var e = estados[t.id];
  var puedeAvanzar = (e.fase === 'listo' || e.fase === 'revision');
  return '<div class="job-pie">' +
      '<button class="btn" type="button" data-accion="preparar"' +
        (e.fase === 'cargando' ? ' disabled' : '') + '>' +
        (e.fase === 'listo' ? 'Volver a obtener datos' : 'Obtener datos') +
      '</button>' +
      '<button class="job-flecha" type="button" data-accion="abrir"' +
        ' aria-label="Revisar ' + esc(t.titulo) + '"' +
        (puedeAvanzar ? '' : ' disabled') + '>→</button>' +
    '</div>';
}

function bloqueRevisionPie() {
  return '<div class="job-revision-pie">' +
      '<button class="job-flecha" type="button" data-accion="cerrar"' +
        ' aria-label="Regresar">←</button>' +
      '<button class="btn enviar" type="button" data-accion="enviar">ENVIAR</button>' +
    '</div>';
}

/* ---- Tarjeta compacta (Correo QA / Correo Backlog) --------------------- */

function plantillaTrabajo(t) {
  var e = estados[t.id];

  if (e.fase !== 'revision') {
    return bloqueCabecera(t) + bloqueEstado(t) + bloquePie(t);
  }

  /* Estado desplegado: resumen de revision. Sin direcciones de correo. */
  return bloqueCabecera(t) + bloqueEstado(t) +
    '<div class="job-revision">' +
      '<h4>Revisar ' + esc(t.titulo) + '</h4>' +
      '<dl class="job-datos">' +
        '<dt>Periodo</dt><dd>' + esc(e.periodo) + '</dd>' +
        '<dt>Datos</dt><dd class="job-ok">✅</dd>' +
        '<dt>Reportes</dt><dd class="job-ok">✅</dd>' +
        '<dt>Graficas</dt><dd class="job-ok">✅</dd>' +
        '<dt>Adjuntos</dt><dd>' + esc(t.adjuntos) + '</dd>' +
        '<dt>Destinatarios</dt><dd>' +
          (t.destinatarios > 0 ? esc(t.destinatarios) + ' configurados' : 'sin configurar') +
        '</dd>' +
        '<dt>Listo para enviar</dt><dd class="job-ok">✅</dd>' +
      '</dl>' +
      '<div class="job-nota">Vista previa. El envio todavia no esta conectado.</div>' +
      bloqueRevisionPie() +
    '</div>';
}

/* ---- Tarjeta destacada (Servicios) ------------------------------------ */

/* Selector de servicios + control de fecha. Todo vive en el navegador: la
   seleccion no viaja a ningun lado y la fecha no consulta nada. */
function bloqueControlesServicios(t) {
  var e = estados[t.id];
  var manual = (e.modoFecha === 'manual');

  var casillas = SERVICIOS_DISPONIBLES.map(function (s) {
    var marcado = e.seleccion.indexOf(s.id) !== -1;
    return '<label class="serv-casilla' + (marcado ? ' marcada' : '') + '">' +
        '<input type="checkbox" data-campo="servicio" value="' + esc(s.id) + '"' +
          (marcado ? ' checked' : '') + '>' +
        '<span>' + esc(s.nombre) + '</span>' +
      '</label>';
  }).join('');

  return '<div class="serv-controles">' +
      '<div class="serv-bloque">' +
        '<h4>Servicios incluidos</h4>' +
        '<div class="serv-lista">' + casillas + '</div>' +
        '<div class="serv-conteo">Seleccionados: ' +
          '<b data-rol="conteo">' + e.seleccion.length + '</b>' +
        '</div>' +
      '</div>' +
      '<div class="serv-bloque">' +
        '<h4>Fecha del reporte</h4>' +
        '<div class="serv-modos">' +
          '<label class="serv-radio' + (manual ? '' : ' marcada') + '">' +
            '<input type="radio" name="serv-modo-fecha" data-campo="modo-fecha"' +
              ' value="auto"' + (manual ? '' : ' checked') + '>' +
            '<span>Automatica</span>' +
          '</label>' +
          '<label class="serv-radio' + (manual ? ' marcada' : '') + '">' +
            '<input type="radio" name="serv-modo-fecha" data-campo="modo-fecha"' +
              ' value="manual"' + (manual ? ' checked' : '') + '>' +
            '<span>Manual</span>' +
          '</label>' +
        '</div>' +
        (manual
          ? '<div class="serv-fecha-manual">' +
              '<input type="date" data-campo="fecha-manual" value="' + esc(e.fechaManual) + '">' +
              '<button class="btn gris chico" type="button" data-accion="fecha-auto">' +
                'Volver a automatica' +
              '</button>' +
            '</div>'
          : '<div class="serv-nota-fecha">Se usa el dia anterior al actual.</div>') +
        '<div class="serv-fecha-resumen">' +
          '<span class="serv-fecha-valor" data-rol="fecha">' + esc(servFechaTexto(e)) + '</span>' +
          '<span class="serv-etiqueta-modo' + (manual ? ' manual' : '') + '">' +
            (manual ? 'Fecha manual' : 'Fecha automatica') +
          '</span>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function plantillaServicios(t) {
  var e = estados[t.id];

  if (e.fase !== 'revision') {
    return bloqueCabecera(t) + bloqueEstado(t) +
      bloqueControlesServicios(t) + bloquePie(t);
  }

  var elegidos = servSeleccionados(e);
  var nombres = elegidos.map(function (s) { return s.nombre; }).join(' · ');

  return bloqueCabecera(t) + bloqueEstado(t) +
    '<div class="job-revision">' +
      '<h4>Servicios — revision</h4>' +
      '<dl class="job-datos">' +
        '<dt>Servicios</dt><dd>' + esc(nombres || 'ninguno') + '</dd>' +
        '<dt>Seleccionados</dt><dd>' + esc(elegidos.length) + '</dd>' +
        '<dt>Fecha del reporte</dt><dd>' + esc(servFechaTexto(e)) + '</dd>' +
        '<dt>Modo</dt><dd>' + (e.modoFecha === 'manual' ? 'Manual' : 'Automatica') + '</dd>' +
        '<dt>Datos</dt><dd class="job-ok">✅</dd>' +
        '<dt>Reporte</dt><dd class="job-ok">✅</dd>' +
        '<dt>Archivos</dt><dd class="job-ok">✅</dd>' +
        '<dt>Destinatarios</dt><dd>' +
          (t.destinatarios > 0 ? 'configurados' : 'sin configurar') +
        '</dd>' +
      '</dl>' +
      '<div class="job-nota">Vista previa. El envio todavia no esta conectado.</div>' +
      bloqueRevisionPie() +
    '</div>';
}

function pintarTrabajo(t) {
  var el = document.getElementById('job-' + t.id);
  if (!el) { return; }
  el.dataset.estado = estados[t.id].fase;
  el.innerHTML = t.destacado ? plantillaServicios(t) : plantillaTrabajo(t);
}

function pintarTodo() {
  var grid = document.getElementById('grid-correos');
  grid.innerHTML = TRABAJOS_CORREO.map(function (t) {
    return '<article class="job' + (t.destacado ? ' destacado' : '') + '"' +
           ' id="job-' + esc(t.id) + '" data-id="' + esc(t.id) + '"' +
           ' data-estado="inicial"></article>';
  }).join('');
  TRABAJOS_CORREO.forEach(pintarTrabajo);

  var grid2 = document.getElementById('grid-herramientas');
  grid2.innerHTML = HERRAMIENTAS.map(function (h) {
    return '<article class="job" data-herramienta="' + esc(h.id) + '">' +
        '<div class="job-cab">' +
          '<div class="job-icono" aria-hidden="true">' + esc(h.icono) + '</div>' +
          '<div class="job-tit">' +
            '<h3>' + esc(h.titulo) + '</h3>' +
            '<p>' + esc(h.descripcion) + '</p>' +
          '</div>' +
        '</div>' +
        '<div class="job-estado">' +
          '<span class="job-punto" aria-hidden="true"></span>' +
          '<span>' + esc(h.estado) + '</span>' +
        '</div>' +
        '<div class="job-pie">' +
          '<button class="btn" type="button">' + esc(h.accion) + '</button>' +
        '</div>' +
      '</article>';
  }).join('');
}

/* ---- Transiciones simuladas ------------------------------------------- */

/* "Obtener datos". Aqui NO se ejecuta nada: solo se pasa por un estado
   intermedio para que la espera se vea, y se marca la tarjeta como lista.
   Este es el punto donde despues entraria la operacion del servidor. */
function prepararTrabajo(t) {
  var e = estados[t.id];
  if (e.fase === 'cargando') { return; }

  e.fase = 'cargando';
  pintarTrabajo(t);

  clearTimeout(e.temporizador);
  e.temporizador = setTimeout(function () {
    e.fase = 'listo';
    e.periodo = periodoTexto();
    pintarTrabajo(t);
  }, 700);
}

function abrirRevision(t) {
  var e = estados[t.id];
  if (e.fase !== 'listo') { return; }
  e.fase = 'revision';
  pintarTrabajo(t);
}

function cerrarRevision(t) {
  var e = estados[t.id];
  if (e.fase !== 'revision') { return; }
  e.fase = 'listo';
  pintarTrabajo(t);
}

/* ---- Modal ------------------------------------------------------------ */

var modalFondo, modalTitulo, modalTexto, focoPrevio;

function abrirModal(titulo, texto) {
  modalTitulo.textContent = titulo;
  modalTexto.textContent = texto;
  focoPrevio = document.activeElement;
  modalFondo.hidden = false;
  document.getElementById('modal-cerrar').focus();
}

function cerrarModal() {
  modalFondo.hidden = true;
  if (focoPrevio && focoPrevio.focus) { focoPrevio.focus(); }
}

/* ---- Arranque --------------------------------------------------------- */

function trabajoDeEvento(ev) {
  var tarjeta = ev.target.closest('.job[data-id]');
  if (!tarjeta) { return null; }
  return TRABAJOS_CORREO.filter(function (t) { return t.id === tarjeta.dataset.id; })[0] || null;
}

function iniciar() {
  TRABAJOS_CORREO.forEach(function (t) {
    estados[t.id] = { fase: 'inicial', periodo: '', temporizador: null };
    if (t.destacado) {
      /* Estado extra solo de Servicios: seleccion y fecha. Arranca en modo
         automatico, con la fecha del dia anterior calculada al vuelo. */
      estados[t.id].seleccion = SERVICIOS_DISPONIBLES
        .filter(function (s) { return s.pordefecto; })
        .map(function (s) { return s.id; });
      estados[t.id].modoFecha = 'auto';
      estados[t.id].fechaManual = isoLocal(fechaAutomatica());
    }
  });

  pintarTodo();

  modalFondo  = document.getElementById('modal-fondo');
  modalTitulo = document.getElementById('modal-titulo');
  modalTexto  = document.getElementById('modal-texto');

  var gridCorreos = document.getElementById('grid-correos');

  /* Un solo escucha por rejilla: el HTML se regenera en cada transicion. */
  gridCorreos.addEventListener('click', function (ev) {
    var boton = ev.target.closest('[data-accion]');
    if (!boton) { return; }
    var trabajo = trabajoDeEvento(ev);
    if (!trabajo) { return; }

    switch (boton.dataset.accion) {
      case 'preparar': prepararTrabajo(trabajo); break;
      case 'abrir':    abrirRevision(trabajo);   break;
      case 'cerrar':   cerrarRevision(trabajo);  break;
      case 'fecha-auto':
        estados[trabajo.id].modoFecha = 'auto';
        pintarTrabajo(trabajo);
        break;
      case 'enviar':
        abrirModal(
          'Envio no habilitado',
          'El envio de "' + trabajo.titulo + '" todavia no esta conectado. ' +
          'Esta pantalla es una vista previa: no se ejecuto ningun script, no ' +
          'se abrio ninguna conexion SMTP y no se envio ningun correo.'
        );
        break;
    }
  });

  /* Controles de Servicios. La seleccion y la fecha se quedan en memoria: no
     se manda nada a ningun lado. Para no perder el foco mientras se escribe,
     la casilla y la fecha actualizan solo el texto que cambia; el cambio de
     modo si vuelve a pintar la tarjeta, porque aparece o desaparece el campo
     de fecha manual. */
  gridCorreos.addEventListener('change', function (ev) {
    var campo = ev.target.closest('[data-campo]');
    if (!campo) { return; }
    var trabajo = trabajoDeEvento(ev);
    if (!trabajo) { return; }
    var e = estados[trabajo.id];
    var tarjeta = ev.target.closest('.job[data-id]');

    switch (campo.dataset.campo) {
      case 'servicio':
        var i = e.seleccion.indexOf(campo.value);
        if (campo.checked && i === -1) { e.seleccion.push(campo.value); }
        if (!campo.checked && i !== -1) { e.seleccion.splice(i, 1); }
        campo.closest('.serv-casilla').classList.toggle('marcada', campo.checked);
        tarjeta.querySelector('[data-rol="conteo"]').textContent = e.seleccion.length;
        break;

      case 'modo-fecha':
        e.modoFecha = (campo.value === 'manual') ? 'manual' : 'auto';
        pintarTrabajo(trabajo);
        break;

      case 'fecha-manual':
        e.fechaManual = campo.value || isoLocal(fechaAutomatica());
        tarjeta.querySelector('[data-rol="fecha"]').textContent = servFechaTexto(e);
        break;
    }
  });

  document.getElementById('grid-herramientas').addEventListener('click', function (ev) {
    var boton = ev.target.closest('button');
    if (!boton) { return; }
    var tarjeta = boton.closest('[data-herramienta]');
    var h = HERRAMIENTAS.filter(function (x) { return x.id === tarjeta.dataset.herramienta; })[0];
    if (!h) { return; }
    abrirModal(
      h.titulo,
      'Esta accion administrativa todavia no esta habilitada. La consola es ' +
      'por ahora solo visual: no ejecuta procesos ni modifica datos.'
    );
  });

  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  modalFondo.addEventListener('click', function (ev) {
    if (ev.target === modalFondo) { cerrarModal(); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !modalFondo.hidden) { cerrarModal(); }
  });
}

document.addEventListener('DOMContentLoaded', iniciar);
