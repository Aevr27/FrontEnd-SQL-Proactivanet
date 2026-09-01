/* =========================================================================
   admin.js — consola de administracion

   Las tres tarjetas de correo (QA, Backlog, Servicios) SI ejecutan:
   el boton ENVIAR hace POST a handlers/admin_correos.ashx, que lanza
   powershell.exe sobre el .ps1 correspondiente desde su propia carpeta.

   Lo que este archivo NO hace, a proposito:
     - no decide que script se ejecuta: solo manda el identificador del
       flujo (qa | backlog | servicios); los nombres de los .ps1 y sus
       carpetas viven en el handler y en Web.config;
     - no calcula la fecha de corte: la trae del servidor, que es quien se
       la pasa al script;
     - no replica nada de la logica de los scripts (SQL, SMTP, reportes);
     - no consulta la base de datos ni muestra direcciones de correo.

   "Obtener datos" sigue siendo un paso local de la pantalla: prepara la
   revision. La ejecucion real ocurre unicamente al pulsar ENVIAR, y el
   resultado que se muestra es el del proceso de PowerShell (codigo de
   salida, stdout, stderr), no el del request HTTP.
   ========================================================================= */

'use strict';

/* Endpoint unico de la consola. Solo acepta los tres flujos de abajo. */
var ENDPOINT = 'handlers/admin_correos.ashx';

/* -------------------------------------------------------------------------
   Los tres flujos de correo.

   `id` es lo unico que viaja al servidor. `script` es informativo: el
   handler tiene el nombre fijo por su cuenta y no acepta rutas del
   navegador.
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
    script: 'Enviar_CorreoBacklog_direccion.ps1',
    adjuntos: 2,
    destinatarios: 2
  },
  {
    id: 'servicios',
    icono: '🧩',
    titulo: 'Servicios',
    descripcion: 'Reporte por servicio para la fecha de corte, con sus adjuntos.',
    script: 'Enviar_CorreoServicio.ps1',
    adjuntos: 0,
    destinatarios: 3,
    destacado: true
  }
];

/* Metadatos que manda el servidor (GET al endpoint): lista blanca de
   servicios, fecha de corte calculada alli y disponibilidad de cada script.
   Hasta que llegan, la tarjeta de Servicios se muestra cargando. */
var META = { fechaCorte: '', servicios: [], flujos: {}, cargado: false, error: '' };

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
  inicial:   'Sin preparar',
  cargando:  'Preparando datos...',
  listo:     'Datos listos ✅',
  revision:  'En revision ✅',
  ejecutando:'Ejecutando el script...'
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

/* Convierte aaaa-mm-dd a Date local sin pasar por UTC (evita el corrimiento
   de un dia que produce new Date('2026-08-30')). */
function desdeIso(iso) {
  var t = String(iso || '').split('-');
  if (t.length !== 3) { return null; }
  return new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
}

/* Periodo mostrado en la revision: los ultimos 14 dias hasta hoy. Es solo
   texto para la vista previa; no se consulta nada con estas fechas. */
function periodoTexto() {
  var fin = new Date();
  var ini = new Date(fin.getTime() - 14 * 24 * 60 * 60 * 1000);
  return ddmmaaaa(ini) + ' → ' + ddmmaaaa(fin);
}

/* ---- Metadatos del servidor ------------------------------------------- */

/* GET al endpoint: no ejecuta nada, solo devuelve la lista blanca de
   servicios, la fecha de corte del servidor y si cada script esta
   localizable con la configuracion actual. */
function cargarMetadatos() {
  return fetch(ENDPOINT, { method: 'GET' })
    .then(function (r) {
      return r.json().catch(function () {
        throw new Error('Respuesta HTTP ' + r.status + ' sin JSON.');
      });
    })
    .then(function (d) {
      if (d && d.error) { throw new Error(d.error); }
      META.fechaCorte = d.fechaCorte || '';
      META.servicios  = d.servicios || [];
      META.flujos     = d.flujos || {};
      META.cargado    = true;
      META.error      = '';
    })
    .catch(function (e) {
      META.cargado = true;
      META.error = String(e && e.message ? e.message : e);
    })
    .then(function () {
      TRABAJOS_CORREO.forEach(function (t) {
        /* Si el servicio elegido ya no esta en la lista blanca, se descarta. */
        var e = estados[t.id];
        if (t.destacado && e.servicio && META.servicios.indexOf(e.servicio) === -1) {
          e.servicio = '';
        }
        pintarTrabajo(t);
      });
    });
}

/* Fecha de corte tal como la mostrara y usara el servidor. */
function fechaCorteTexto() {
  var d = desdeIso(META.fechaCorte);
  return d ? ddmmaaaa(d) + ' (' + META.fechaCorte + ')' : '—';
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
  /* Servicios no tiene "Obtener datos": su estado inicial habla del
     servicio, no de datos por preparar. */
  var etiqueta = ETIQUETA_ESTADO[e.fase];
  if (t.destacado && e.fase === 'inicial') {
    etiqueta = e.servicio ? 'Servicio elegido ✅' : 'Sin servicio elegido';
  }
  return '<div class="job-estado">' +
      '<span class="job-punto" aria-hidden="true"></span>' +
      '<span data-rol="etiqueta">' + esc(etiqueta) + '</span>' +
      '<span class="job-script" title="' + esc(t.script) + '">' + esc(t.script) + '</span>' +
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

/* Pie de Servicios: no tiene "Obtener datos". Se pasa a revision en cuanto
   hay un servicio elegido y el script esta localizable. */
function bloquePieServicios(t) {
  var e = estados[t.id];
  var listo = !!e.servicio && flujoDisponible(t.id);
  return '<div class="job-pie">' +
      '<button class="job-flecha" type="button" data-accion="abrir"' +
        ' aria-label="Revisar ' + esc(t.titulo) + '"' +
        (listo ? '' : ' disabled') + '>→</button>' +
    '</div>';
}

function bloqueRevisionPie(t) {
  var e = estados[t.id];
  var enviando = !!e.enviando;
  return '<div class="job-revision-pie">' +
      '<button class="job-flecha" type="button" data-accion="cerrar"' +
        ' aria-label="Regresar"' + (enviando ? ' disabled' : '') + '>←</button>' +
      '<button class="btn enviar" type="button" data-accion="enviar"' +
        (enviando || !flujoDisponible(t.id) ? ' disabled' : '') + '>' +
        (enviando ? 'Ejecutando...' : 'ENVIAR') +
      '</button>' +
    '</div>';
}

function flujoDisponible(id) {
  var f = META.flujos[id];
  return !META.cargado ? false : !!(f && f.disponible);
}

/* Aviso cuando el script no se puede localizar con la configuracion actual:
   se dice antes de dejar pulsar ENVIAR, no despues de fallar. */
function bloqueAvisoConfig(t) {
  if (!META.cargado) {
    return '<div class="job-nota">Comprobando la configuracion del servidor...</div>';
  }
  if (META.error) {
    return '<div class="job-nota job-nota-fallo">No se pudo leer la configuracion: ' +
      esc(META.error) + '</div>';
  }
  var f = META.flujos[t.id];
  if (f && !f.disponible) {
    return '<div class="job-nota job-nota-fallo">Script no disponible: ' +
      esc(f.problema || 'revisar Web.config.') + '</div>';
  }
  return '';
}

/* Resultado de la ultima ejecucion de esta tarjeta. */
function bloqueEjecucion(t) {
  var e = estados[t.id];
  if (!e.ejecucion) { return ''; }
  var r = e.ejecucion;
  return '<div class="job-ejecucion ' + esc(r.clase) + '">' +
      '<div class="job-ejecucion-tit">' + esc(r.titulo) + '</div>' +
      (r.detalle ? '<pre class="job-ejecucion-salida">' + esc(r.detalle) + '</pre>' : '') +
    '</div>';
}

/* ---- Tarjeta compacta (Correo QA / Correo Backlog) --------------------- */

function plantillaTrabajo(t) {
  var e = estados[t.id];

  if (e.fase !== 'revision') {
    return bloqueCabecera(t) + bloqueEstado(t) + bloqueEjecucion(t) + bloquePie(t);
  }

  /* Estado desplegado: resumen de revision. Sin direcciones de correo. */
  return bloqueCabecera(t) + bloqueEstado(t) +
    '<div class="job-revision">' +
      '<h4>Revisar ' + esc(t.titulo) + '</h4>' +
      '<dl class="job-datos">' +
        '<dt>Periodo</dt><dd>' + esc(e.periodo) + '</dd>' +
        '<dt>Script</dt><dd>' + esc(t.script) + '</dd>' +
        '<dt>Datos</dt><dd class="job-ok">✅</dd>' +
        '<dt>Reportes</dt><dd class="job-ok">✅</dd>' +
        '<dt>Graficas</dt><dd class="job-ok">✅</dd>' +
        '<dt>Adjuntos</dt><dd>' + esc(t.adjuntos) + '</dd>' +
        '<dt>Destinatarios</dt><dd>' +
          (t.destinatarios > 0 ? esc(t.destinatarios) + ' configurados' : 'sin configurar') +
        '</dd>' +
        '<dt>Listo para enviar</dt><dd class="job-ok">✅</dd>' +
      '</dl>' +
      bloqueAvisoConfig(t) +
      bloqueEjecucion(t) +
      bloqueRevisionPie(t) +
    '</div>';
}

/* ---- Tarjeta destacada (Servicios) ------------------------------------ */

/* Seleccion de UN servicio (es lo que acepta -Servicio) mas la fecha de
   corte, que llega calculada del servidor y no se puede editar aqui. */
function bloqueControlesServicios(t) {
  var e = estados[t.id];

  var opciones;
  if (!META.cargado) {
    opciones = '<div class="serv-nota-fecha">Cargando servicios...</div>';
  } else if (!META.servicios.length) {
    opciones = '<div class="serv-nota-fecha">Sin servicios configurados ' +
      '(clave AdminServiciosPermitidos en Web.config).</div>';
  } else {
    opciones = META.servicios.map(function (nombre) {
      var marcado = (e.servicio === nombre);
      return '<label class="serv-casilla' + (marcado ? ' marcada' : '') + '">' +
          '<input type="radio" name="serv-servicio" data-campo="servicio"' +
            ' value="' + esc(nombre) + '"' + (marcado ? ' checked' : '') + '>' +
          '<span>' + esc(nombre) + '</span>' +
        '</label>';
    }).join('');
  }

  return '<div class="serv-controles">' +
      '<div class="serv-bloque">' +
        '<h4>Servicio</h4>' +
        '<div class="serv-lista">' + opciones + '</div>' +
        '<div class="serv-conteo">Seleccionado: ' +
          '<b data-rol="servicio">' + esc(e.servicio || 'ninguno') + '</b>' +
        '</div>' +
      '</div>' +
      '<div class="serv-bloque">' +
        '<h4>Fecha de corte</h4>' +
        '<div class="serv-nota-fecha">La calcula el servidor: el dia anterior ' +
          'al actual. No se puede cambiar desde aqui.</div>' +
        '<div class="serv-fecha-resumen">' +
          '<span class="serv-fecha-valor" data-rol="fecha">' + esc(fechaCorteTexto()) + '</span>' +
          '<span class="serv-etiqueta-modo">Fecha del servidor</span>' +
        '</div>' +
      '</div>' +
    '</div>';
}

function plantillaServicios(t) {
  var e = estados[t.id];

  if (e.fase !== 'revision') {
    return bloqueCabecera(t) + bloqueEstado(t) + bloqueControlesServicios(t) +
      bloqueAvisoConfig(t) + bloqueEjecucion(t) + bloquePieServicios(t);
  }

  return bloqueCabecera(t) + bloqueEstado(t) +
    '<div class="job-revision">' +
      '<h4>Servicios — revision</h4>' +
      '<dl class="job-datos">' +
        '<dt>Servicio</dt><dd>' + esc(e.servicio || 'ninguno') + '</dd>' +
        '<dt>Fecha de corte</dt><dd>' + esc(META.fechaCorte || '—') + '</dd>' +
        '<dt>Script</dt><dd>' + esc(t.script) + '</dd>' +
        '<dt>Parametros</dt><dd>' +
          esc('-Servicio "' + (e.servicio || '') + '" -FechaCorte "' + (META.fechaCorte || '') + '"') +
        '</dd>' +
        '<dt>Destinatarios</dt><dd>' +
          (t.destinatarios > 0 ? 'configurados' : 'sin configurar') +
        '</dd>' +
      '</dl>' +
      bloqueAvisoConfig(t) +
      bloqueEjecucion(t) +
      bloqueRevisionPie(t) +
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

/* ---- Transiciones ------------------------------------------------------ */

/* "Obtener datos": paso local de la pantalla. No ejecuta nada; deja la
   tarjeta lista para la revision. */
function prepararTrabajo(t) {
  var e = estados[t.id];
  if (e.fase === 'cargando' || e.enviando) { return; }

  e.fase = 'cargando';
  e.ejecucion = null;
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
  if (t.destacado) {
    if (!e.servicio) { return; }
  } else if (e.fase !== 'listo') {
    return;
  }
  e.fase = 'revision';
  pintarTrabajo(t);
}

function cerrarRevision(t) {
  var e = estados[t.id];
  if (e.fase !== 'revision' || e.enviando) { return; }
  e.fase = t.destacado ? 'inicial' : 'listo';
  pintarTrabajo(t);
}

/* ---- Ejecucion real ---------------------------------------------------- */

/* ENVIAR. Manda al servidor solo el identificador del flujo (y el servicio,
   cuando aplica) y espera a que termine el proceso de PowerShell. El exito
   se decide por el codigo de salida del proceso, NO por que el request HTTP
   haya respondido. */
function enviarTrabajo(t) {
  var e = estados[t.id];
  if (e.enviando) { return; }                 // sin ejecuciones duplicadas
  if (!flujoDisponible(t.id)) { return; }
  if (t.destacado && !e.servicio) { return; }

  var cuerpo = 'flujo=' + encodeURIComponent(t.id);
  if (t.destacado) { cuerpo += '&servicio=' + encodeURIComponent(e.servicio); }

  e.enviando = true;
  e.faseAnterior = e.fase;
  e.fase = 'ejecutando';
  e.ejecucion = { clase: 'en-curso', titulo: 'Ejecutando ' + t.script + '...', detalle: '' };
  pintarTrabajo(t);

  fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: cuerpo
  })
    .then(function (r) {
      /* El handler devuelve JSON tanto en el caso bueno como en el error
         (500 con { error, tipo }), asi que se lee el cuerpo siempre. */
      return r.json().catch(function () {
        throw new Error('Respuesta HTTP ' + r.status + ' sin JSON.');
      });
    })
    .then(function (d) {
      if (d.ok) {
        e.ejecucion = {
          clase: 'ok',
          titulo: 'Correcto — el script termino con codigo 0 (' + d.duracionMs + ' ms)',
          detalle: d.salida || 'Sin salida.'
        };
        return;
      }
      /* Excepcion del handler: no llego a haber proceso. */
      if (d.codigoSalida === undefined) {
        e.ejecucion = {
          clase: 'fallo',
          titulo: 'Fallo — ' + (d.tipo || 'error') + ' en el servidor',
          detalle: d.error || 'Sin detalle.'
        };
        return;
      }
      /* Hubo proceso, pero termino mal. Backlog y Servicios documentan el
         codigo 5 (configuracion, SQL, Excel o SMTP) y dejan el detalle en su
         carpeta Logs\. QA no atrapa sus errores: sale con 1 y solo deja lo
         que haya escrito en la salida de error. */
      e.ejecucion = {
        clase: 'fallo',
        titulo: 'Fallo — codigo de salida ' + d.codigoSalida +
          (d.codigoSalida === 5 ? ' (revisar la carpeta Logs\\ del script)' : ''),
        detalle: [d.error, d.salida].filter(Boolean).join('\n') || 'Sin salida.'
      };
    })
    .catch(function (err) {
      e.ejecucion = {
        clase: 'fallo',
        titulo: 'Fallo — no se pudo contactar con el servidor',
        detalle: String(err && err.message ? err.message : err)
      };
    })
    .then(function () {
      e.enviando = false;
      e.fase = e.faseAnterior || 'revision';
      pintarTrabajo(t);
    });
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
    estados[t.id] = {
      fase: 'inicial', periodo: '', temporizador: null,
      enviando: false, ejecucion: null
    };
    /* Estado extra solo de Servicios: el servicio elegido. La fecha no se
       guarda aqui: siempre es la que manda el servidor. */
    if (t.destacado) { estados[t.id].servicio = ''; }
  });

  pintarTodo();

  modalFondo  = document.getElementById('modal-fondo');
  modalTitulo = document.getElementById('modal-titulo');
  modalTexto  = document.getElementById('modal-texto');

  var gridCorreos = document.getElementById('grid-correos');

  /* Un solo escucha por rejilla: el HTML se regenera en cada transicion. */
  gridCorreos.addEventListener('click', function (ev) {
    var boton = ev.target.closest('[data-accion]');
    if (!boton || boton.disabled) { return; }
    var trabajo = trabajoDeEvento(ev);
    if (!trabajo) { return; }

    switch (boton.dataset.accion) {
      case 'preparar': prepararTrabajo(trabajo); break;
      case 'abrir':    abrirRevision(trabajo);   break;
      case 'cerrar':   cerrarRevision(trabajo);  break;
      case 'enviar':   enviarTrabajo(trabajo);   break;
    }
  });

  /* Seleccion de servicio. Solo actualiza el texto que cambia para no
     perder el foco, y repinta el pie porque la flecha se habilita. */
  gridCorreos.addEventListener('change', function (ev) {
    var campo = ev.target.closest('[data-campo="servicio"]');
    if (!campo) { return; }
    var trabajo = trabajoDeEvento(ev);
    if (!trabajo) { return; }
    var e = estados[trabajo.id];
    if (e.enviando) { return; }

    e.servicio = campo.value;
    e.ejecucion = null;
    pintarTrabajo(trabajo);
  });

  document.getElementById('grid-herramientas').addEventListener('click', function (ev) {
    var boton = ev.target.closest('button');
    if (!boton) { return; }
    var tarjeta = boton.closest('[data-herramienta]');
    var h = HERRAMIENTAS.filter(function (x) { return x.id === tarjeta.dataset.herramienta; })[0];
    if (!h) { return; }
    abrirModal(
      h.titulo,
      'Esta accion administrativa todavia no esta habilitada. Las herramientas ' +
      'de esta seccion siguen siendo solo visuales.'
    );
  });

  document.getElementById('modal-cerrar').addEventListener('click', cerrarModal);
  modalFondo.addEventListener('click', function (ev) {
    if (ev.target === modalFondo) { cerrarModal(); }
  });
  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape' && !modalFondo.hidden) { cerrarModal(); }
  });

  cargarMetadatos();
}

document.addEventListener('DOMContentLoaded', iniciar);
