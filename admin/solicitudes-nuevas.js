/* =========================================================================
   admin/solicitudes-nuevas.js - vista "Iniciativas" de la pestaña
   Solicitudes: registro de las Nuevas solicitudes guardadas (sql/29) y su
   revision por ADM (sql/31).

     listar    GET  handlers/admin_iniciativas_solicitudes_nuevas.ashx?accion=listar&estado=
                    (filtro "Estado" como la cola de Cambios: ENVIADA =
                    Pendientes por omision, APROBADA, RECHAZADA; "" = todas)
     detalle   GET  ...?accion=detalle&numero=      la solicitud y su historial
     aprobar   POST handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx?accion=aprobar
                    numero, estado (el Estado inicial; "" = sin estado), comentario (opcional)
     rechazar  POST ...?accion=rechazar             numero, comentario (obligatorio)

   Aprobar CREA la iniciativa (sql/32: la alta de Administracion -> Crear con
   los datos guardados de la solicitud) y el servidor devuelve su codigo.
   ADM elige el Estado inicial (opciones = estados_problem del detalle, o
   "sin estado": queda Incompleta, como en Crear); no hay uno por omision.
   APROBADA y RECHAZADA son finales. Los botones salen solo en una ENVIADA y
   solo si el servidor dice revision_disponible (sql/31); Aprobar, ademas,
   solo con crea_iniciativa (sql/32). "Solicitud aceptada" se dice SOLO con
   la respuesta del servidor y con SU codigo; despues se releen lista y
   detalle. Nunca usa el endpoint de Cambios.

   Conmutador "Iniciativas | Cambios" (solVerNuevas / solVerCambio): "Cambios"
   es la de siempre (admin/solicitudes-cambio.js, en solVistaCambio) y sigue
   siendo la de inicio; esta vista no la toca, solo la oculta o la muestra.

   Solo UX: el servidor exige ADM (AccesoAdmin.ExigirAdm) en los dos
   handlers. Cada respuesta se dice distinto: cargando, sin solicitudes,
   faltan las tablas (501), sin permiso (403), la base fallo (500) y sin
   conexion.
   Se prueba en node: tools/tests/SolicitudesNuevasSmoke.js.
   ========================================================================= */
window.SolicitudesNuevas = (function () {
  'use strict';

  var URL = '../handlers/admin_iniciativas_solicitudes_nuevas.ashx';
  var URL_REVISION = '../handlers/admin_iniciativas_solicitudes_nuevas_revision.ashx';
  var URL_MIAS = '../handlers/admin_iniciativas_mis_solicitudes.ashx';
  // Cancelar (sql/42): quien la envio, por el handler de Nueva solicitud.
  var URL_VALIDAR = '../handlers/admin_iniciativas_validar.ashx';
  var MAXIMO_COMENTARIO = 2000;   // RevisionSolicitudesIniciativa.MaximoComentario
  var MAXIMO_MOTIVO_CANCELACION = 2000;   // SolicitudesIniciativa.MaximoMotivoCancelacion
  var ESTADOS = { ENVIADA: 'Enviada', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada' };
  var EVENTOS = { ENVIADA: 'Enviada', APROBADA: 'Aprobada', RECHAZADA: 'Rechazada', CANCELADA: 'Cancelada', REEMPLAZADA: 'Reemplazada' };
  var SIN_ESTADO = '__sin_estado__';   // opcion explicita: Estado inicial vacio (Incompleta)

  function h(s) { return Escape.html(s === null || s === undefined ? '' : String(s)); }
  function nada(v) { return v === null || v === undefined || v === '' ? '—' : h(v); }
  // "aaaa-mm-ddThh:mm:ssZ" (UTC) -> hora local legible (como la cola de cambios).
  function fechaHora(utc) {
    if (!utc) return '—';
    var d = new Date(utc);
    if (isNaN(d.getTime())) return h(utc);
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }
  function estado(e) { return e ? h(ESTADOS[e] || e) : '—'; }
  // Como se muestra quien la envio: lo que decide el servidor
  // (solicitante_mostrar: UsuariosAdmin.NombreSolicitante -> nombre guardado
  // -> correo -> cuenta); sin el, como antes. El correo va debajo si lo
  // mostrado no es ya el correo.
  function textoSolicitante(s) { return s.solicitante_mostrar || s.solicitante_nombre || s.solicitante_cuenta; }
  function solicitante(s) {
    var t = textoSolicitante(s);
    return nada(t) + (s.solicitante_correo && s.solicitante_correo !== t ? '<span class="ini-sub">' + h(s.solicitante_correo) + '</span>' : '');
  }

  // sql/42: la relacion con la que esta corrige / la que la reemplazo
  // ({ numero, numero_texto }; el servidor solo manda las que esta cuenta
  // puede ver). Corta en la lista; con botones (data-sn-ir) en el detalle.
  function relacionCorta(s) {
    return (s.reemplaza_a ? '<span class="ini-sub">corrige a ' + h(s.reemplaza_a.numero_texto) + '</span>' : '') +
      (s.reemplazada_por ? '<span class="ini-sub">reemplazada por ' + h(s.reemplazada_por.numero_texto) + '</span>' : '');
  }
  function relacion(d) {
    function ir(x) { return '<button type="button" class="ini-folio" data-sn-ir="' + h(x.numero) + '">' + h(x.numero_texto) + '</button>'; }
    var partes = [];
    if (d.reemplaza_a) partes.push('Corrige a la solicitud ' + ir(d.reemplaza_a) + ' (quedó cancelada).');
    if (d.reemplazada_por) partes.push('Reemplazada por la solicitud ' + ir(d.reemplazada_por) + '.');
    return partes.length ? '<p class="ini-nota ini-sol-relacion">' + partes.join(' ') + '</p>' : '';
  }
  // Cancelar / Modificar de QUIEN LA ENVIO (puede_cancelar del servidor:
  // suya, ENVIADA y sql/42). p: prefijo de los id ('sn' ADM, 'ms' Mis).
  function htmlPropias(d, p) {
    if (d.puede_cancelar !== true) return '';
    return '<div class="ini-sol-propias"><h5>Tu solicitud</h5>' +
      '<p class="ini-nota">Mientras siga pendiente puedes cancelarla o modificarla. Modificar no la edita: abre Nueva solicitud con sus datos; ' +
      'al enviarla se crea una solicitud nueva con otro número (ADM la revisa desde el principio) y esta queda cancelada. Nada se borra.</p>' +
      '<div class="ini-cambio-campos"><div class="campo ini-cambio-ancho"><label for="' + p + 'MotivoCancelacion">Motivo (obligatorio para cancelar)</label>' +
      '<textarea id="' + p + 'MotivoCancelacion" rows="2" maxlength="' + MAXIMO_MOTIVO_CANCELACION + '"></textarea></div></div>' +
      '<div class="ini-cambio-pie"><button type="button" class="btn linea chico" data-sx-accion="cancelar">Cancelar solicitud</button> ' +
      '<button type="button" class="btn linea chico" data-sx-accion="modificar">Modificar</button></div></div>';
  }

  // El Codigo de la iniciativa que creo la aprobacion: boton (data-ini-ref)
  // que abre su detalle sin cambiar de pestaña cuando la pagina sabe
  // abrirlo (conRef = hay alVerIniciativa); si no, texto como antes.
  function refIniciativa(codigo, conRef) {
    if (!codigo) return '';
    return conRef
      ? '<button type="button" class="ini-folio ini-ref" data-ini-ref="' + h(codigo) + '" title="Ver la iniciativa">' + h(codigo) + '</button>'
      : h(codigo);
  }
  // Clic en una referencia (data-ini-ref): la abre dueno.alVerIniciativa y,
  // si no se pudo (no existe o no la ve esta cuenta), avisar(texto) lo dice.
  // -> true si el clic era de una referencia (la fila no se abre).
  function clicReferencia(e, dueno, avisar) {
    var b = e.target && e.target.closest ? e.target.closest('[data-ini-ref]') : null;
    if (!b || typeof dueno.alVerIniciativa !== 'function') return false;
    var r = dueno.alVerIniciativa(b.getAttribute('data-ini-ref'), b);
    if (r && r.mensaje) avisar(r.mensaje);
    return true;
  }

  // vacio: el texto sin solicitudes (Mis solicitudes dice otro).
  // conRef: el Codigo de la iniciativa creada es un boton (refIniciativa).
  function htmlLista(lista, vacio, conRef) {
    if (!lista.length) return '<p class="ini-nota">' + h(vacio || 'Todavía no hay solicitudes nuevas guardadas.') + '</p>';
    return '<table class="ini-det-tabla ini-sol-tabla"><thead><tr><th scope="col">Número</th><th scope="col">Tipo</th>' +
      '<th scope="col">Título</th><th scope="col">Solicitó</th><th scope="col">Product Owner</th><th scope="col">Service Owner</th>' +
      '<th scope="col">Categoría</th><th scope="col">Enviada</th><th scope="col">Estado</th></tr></thead><tbody>' +
      lista.map(function (s) {
        return '<tr class="ini-sol-fila" data-sn-numero="' + h(s.numero) + '">' +
          '<td><button type="button" class="ini-folio" data-sn-numero="' + h(s.numero) + '">' + h(s.numero_texto) + '</button></td>' +
          '<td>' + nada(s.tipo) + '</td><td>' + nada(s.titulo) + '</td><td>' + solicitante(s) + '</td>' +
          '<td>' + nada(s.po) + '</td><td>' + nada(s.so) + '</td><td class="ini-cat-ruta">' + nada(s.categoria) + '</td>' +
          '<td>' + fechaHora(s.fecha_utc) + '</td><td>' + estado(s.estado) +
          (s.codigo_iniciativa ? '<span class="ini-sub">' + refIniciativa(s.codigo_iniciativa, conRef) + '</span>' : '') + relacionCorta(s) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // "Mostrando las 200 más recientes de 250." solo si hay mas de las que se ven.
  function textoTotal(j) {
    var n = (j.solicitudes || []).length;
    return typeof j.total === 'number' && j.total > n
      ? 'Mostrando las ' + n + ' más recientes de ' + j.total + '.'
      : '';
  }

  // Tickets a reducir AL ENVIAR: la volumetria y el % guardados de la
  // solicitud con ticketsDe de admin/iniciativas.js (FLOOR, la regla de
  // Nueva solicitud), no un calculo propio. Es una estimacion: al aprobar,
  // la base recalcula TicketsReduce con su propia ventana de 30 dias y su
  // redondeo. Sin ticketsDe (iniciativas.js no cargo) o sin datos: '—'.
  function ticketsAlEnviar(d) {
    var I = window.Iniciativas;
    if (!I || typeof I.ticketsDe !== 'function') return '—';
    if (typeof d.volumetria !== 'number' || d.pct === null || d.pct === undefined || d.pct === '') return '—';
    var t = I.ticketsDe(d.volumetria, String(d.pct));
    return t === null || t === undefined ? '—' : h(t);
  }

  // Otras iniciativas que HOY consumen la capacidad de la categoria
  // (otras_iniciativas del servidor: la regla del tope de 100%,
  // CapacidadCategoria.Otras), cada una con su % (fraccion). undefined = el
  // servidor no lo manda (no se pinta); null = no se pudo leer.
  function htmlOtras(d) {
    var otras = d.otras_iniciativas;
    if (otras === undefined) return '';
    var cab = '<h5>Otras iniciativas activas en la categoría</h5>';
    if (!Array.isArray(otras)) return cab + '<p class="ini-nota">No se pudieron leer las otras iniciativas de la categoría.</p>';
    if (!otras.length) return cab + '<p class="ini-nota">Ninguna otra iniciativa activa tiene % en esta categoría.</p>';
    var suma = 0;
    var filas = otras.map(function (o) {
      var pct = typeof o.pct === 'number' ? Math.round(o.pct * 10000) / 100 : null;
      if (pct !== null) suma += Math.round(o.pct * 10000);
      return '<tr><td>' + nada(o.folio) + '</td><td class="num">' + (pct === null ? '—' : h(pct) + '%') + '</td><td>' + nada(o.estado) + '</td></tr>';
    }).join('');
    return cab + '<table class="ini-det-tabla"><thead><tr><th scope="col">Iniciativa</th><th scope="col" class="num">% de disminución</th>' +
      '<th scope="col">Estado</th></tr></thead><tbody>' + filas + '</tbody></table>' +
      '<p class="ini-nota">Ya comprometido en la categoría: ' + h(suma / 100) + '% (sin esta solicitud).</p>';
  }

  // puedeRevisar: ADM y revision_disponible. Los botones, solo en ENVIADA.
  // p: prefijo de los id del detalle ('sn' por omision, 'ms' en Mis).
  function htmlDetalle(d, puedeRevisar, p, conRef) {
    p = p || 'sn';
    var revisada = d.estado === 'APROBADA' || d.estado === 'RECHAZADA';
    var filas = [
      ['Tipo de iniciativa', nada(d.tipo)],
      ['Solicitó', solicitante(d) + (d.solicitante_cuenta && textoSolicitante(d) !== d.solicitante_cuenta ? '<span class="ini-sub">' + h(d.solicitante_cuenta) + '</span>' : '')],
      ['Product Owner', nada(d.po) + (d.po_correo ? '<span class="ini-sub">' + h(d.po_correo) + '</span>' : '')],
      ['Service Owner', nada(d.so)],
      ['Categoría', '<span class="ini-cat-ruta">' + nada(d.categoria) + '</span>'],
      ['Director', nada(d.director)],
      ['% de disminución', d.pct === null || d.pct === undefined ? '—' : h(d.pct) + '%'],
      ['Volumetría <span class="ini-sub">al enviar</span>', nada(d.volumetria)],
      ['Tickets a reducir <span class="ini-sub">estimado al enviar; la base lo recalcula al crear la iniciativa</span>', ticketsAlEnviar(d)],
      ['RCA', d.rca_extension ? 'Adjunto .' + h(String(d.rca_extension).toLowerCase()) + ' (el archivo no se guarda)' : '—'],
      ['Enviada', fechaHora(d.fecha_utc)],
      ['Estado', estado(d.estado)],
      ['Iniciativa', d.codigo_iniciativa ? refIniciativa(d.codigo_iniciativa, conRef) : '—']
    ].map(function (f) { return '<tr><th scope="row">' + f[0] + '</th><td>' + f[1] + '</td></tr>'; }).join('');
    var eventos = (d.eventos || []).map(function (e) {
      return '<li><strong>' + h(EVENTOS[e.evento] || e.evento) + '</strong> · ' + fechaHora(e.fecha_utc) + ' · ' + nada(e.usuario) +
        (e.estado_anterior || e.estado_nuevo ? '<span class="ini-sub">' + estado(e.estado_anterior) + ' → ' + estado(e.estado_nuevo) + '</span>' : '') +
        (e.detalle ? '<span class="ini-sub">«' + h(e.detalle) + '»</span>' : '') + '</li>';
    }).join('');
    var revision = revisada
      ? '<p class="ini-nota"><strong>' + estado(d.estado) + '</strong> por ' + nada(d.revisado_por) + ' el ' + fechaHora(d.fecha_revision_utc) +
        (d.comentario_revision ? ': «' + h(d.comentario_revision) + '»' : '') +
        (d.estado === 'APROBADA'
          ? (d.codigo_iniciativa
              ? '<span class="ini-sub">Iniciativa creada con el código: ' + refIniciativa(d.codigo_iniciativa, conRef) + '</span>'
              : '<span class="ini-sub">Se aprobó antes de que aprobar creara la iniciativa: no tiene iniciativa ligada.</span>')
          : '') + '</p>'
      : d.estado === 'CANCELADA'
      ? '<p class="ini-nota"><strong>Cancelada</strong> por quien la envió (' + nada(d.cancelado_por) + ') el ' + fechaHora(d.fecha_cancelacion_utc) +
        (d.motivo_cancelacion ? ': «' + h(d.motivo_cancelacion) + '»' : '') + '</p>'
      : '';
    // Aprobar crea la iniciativa: solo con sql/32 y con las opciones del Estado inicial.
    var estados = Array.isArray(d.estados_problem) ? d.estados_problem : null;
    var puedeAprobar = d.crea_iniciativa === true && estados !== null;
    var avisoAprobar = d.crea_iniciativa !== true
      ? '<p class="ini-nota">Aprobar crea la iniciativa y todavía no está habilitado en la base (falta sql/32). Puedes rechazar.</p>'
      : estados === null ? '<p class="ini-nota">No se pudieron leer los estados de la iniciativa: actualiza antes de aprobar.</p>' : '';
    var campoEstado = puedeAprobar
      ? '<div class="campo"><label for="snEstado">Estado inicial de la iniciativa (al aprobar)</label>' +
        '<select id="snEstado"><option value="">Elige…</option>' +
        '<option value="' + SIN_ESTADO + '">Sin estado (queda Incompleta)</option>' +
        estados.map(function (e) { return '<option value="' + h(e) + '">' + h(e) + '</option>'; }).join('') + '</select></div>'
      : '';
    var acciones = d.estado === 'ENVIADA' && puedeRevisar
      ? avisoAprobar + '<div class="ini-cambio-campos">' + campoEstado +
        '<div class="campo ini-cambio-ancho"><label for="snComentario">Comentario (obligatorio para rechazar; opcional al aprobar)</label>' +
        '<textarea id="snComentario" rows="3" maxlength="' + MAXIMO_COMENTARIO + '"></textarea></div></div>' +
        '<div class="ini-cambio-pie">' +
        (puedeAprobar ? '<button type="button" class="btn chico" data-sn-accion="aprobar">Aprobar y crear iniciativa</button> ' : '') +
        '<button type="button" class="btn linea chico" data-sn-accion="rechazar">Rechazar</button> ' +
        '<button type="button" class="btn linea chico" data-sn-accion="cerrar">Cerrar</button></div>'
      : '<div class="ini-cambio-pie"><button type="button" class="btn linea chico" data-sn-accion="cerrar">Cerrar</button></div>';
    return '<h4>Solicitud ' + h(d.numero_texto) + (d.titulo ? ' · ' + h(d.titulo) : '') + '</h4>' + relacion(d) +
      '<table class="ini-det-tabla"><tbody>' + filas + '</tbody></table>' + htmlOtras(d) +
      '<h5>Descripción</h5><div class="ini-texto">' + nada(d.descripcion) + '</div>' +
      '<h5>Observaciones</h5><div class="ini-texto">' + nada(d.observaciones) + '</div>' + revision +
      '<div class="ini-cambio-msg" id="' + p + 'DetMsg" role="status" aria-live="polite"></div>' + htmlPropias(d, p) + acciones +
      '<h5>Historial de la solicitud</h5>' +
      (eventos ? '<ul class="ini-sol-eventos">' + eventos + '</ul>' : '<p class="ini-nota">Sin eventos registrados.</p>');
  }

  // El texto de una respuesta que no es 200, segun lo que paso.
  function textoError(status, json, que) {
    if (status === 501) return { clase: 'aviso', html: h(json.error || 'El registro de solicitudes nuevas no está disponible en la base.') };
    if (status === 403) return { clase: 'error', html: h(json.error || 'No tienes permiso para ver las solicitudes nuevas.') };
    if (status === 404) return { clase: 'error', html: h(json.error || 'La solicitud no existe.') };
    if (status >= 500) return { clase: 'error', html: 'Error de la base de datos al leer ' + que + ': ' + h(json.error || ('respuesta ' + status)) + '. Intenta de nuevo con «Actualizar».' };
    return { clase: 'error', html: h(json.error || ('No se pudo leer ' + que + ' (respuesta ' + status + ').')) };
  }

  function leer(resp) {
    return Promise.resolve(resp.json()).catch(function () { return null; }).then(function (j) { return { status: resp.status, json: j || {} }; });
  }

  // Cancelar (dos pasos: motivo y confirmar) o Modificar la solicitud
  // abierta de quien la envio. dueno: RegistroSolicitudesNuevas o
  // MisSolicitudes (detalle, pedir, ocupado, listar, verDetalle,
  // alModificar, alCancelar). La base decide si es suya y si sigue ENVIADA:
  // si ADM la reviso antes, el servidor lo dice.
  function accionPropia(dueno, accion, p) {
    var d = dueno.detalle;
    if (!d || dueno.ocupado) return Promise.resolve(null);
    function msg(clase, html) {
      var m = dueno.$(p + 'DetMsg');
      if (m) { m.className = 'ini-cambio-msg ' + clase; m.innerHTML = html; }
    }
    if (accion === 'no-cancelar') { msg('', ''); return Promise.resolve(null); }
    if (accion === 'modificar') {
      var abierto = dueno.alModificar ? dueno.alModificar(d) : false;
      if (!abierto) msg('error', 'No se pudo abrir Nueva solicitud para corregirla (el formulario no está listo o tu cuenta ya no puede solicitar). Actualiza la página.');
      return Promise.resolve(abierto === true);
    }
    var caja = dueno.$(p + 'MotivoCancelacion');
    var motivo = caja ? String(caja.value || '').trim() : '';
    if (!motivo) { msg('error', 'Explica por qué cancelas la solicitud.'); return Promise.resolve(null); }
    if (motivo.length > MAXIMO_MOTIVO_CANCELACION) { msg('error', 'El motivo no puede pasar de 2000 caracteres.'); return Promise.resolve(null); }
    if (accion === 'cancelar') {
      msg('revisar', '¿Cancelar la solicitud ' + h(d.numero_texto) + '? Ya no se podrá aprobar ni modificar; su historial se conserva. ' +
        '<button type="button" class="btn chico" data-sx-accion="confirmar-cancelacion">Sí, cancelarla</button> ' +
        '<button type="button" class="btn linea chico" data-sx-accion="no-cancelar">No</button>');
      return Promise.resolve(null);
    }
    if (accion !== 'confirmar-cancelacion') return Promise.resolve(null);
    var datos = new FormData();
    datos.append('accion', 'cancelar');
    datos.append('numero', String(d.numero));
    datos.append('motivo', motivo);
    dueno.ocupado = true;
    msg('', '<span>Cancelando…</span>');
    return Promise.resolve().then(function () { return dueno.pedir(URL_VALIDAR, { method: 'POST', body: datos, credentials: 'same-origin' }); })
      .then(leer)
      .then(function (r) {
        dueno.ocupado = false;
        var j = r.json, ok = r.status === 200 && j.cancelada === true;
        var html = ok ? '<strong>Solicitud ' + h(d.numero_texto) + ' cancelada.</strong> Ya no se revisa; su historial se conserva.'
          : j.cancelada === null ? h(j.error || 'No se pudo confirmar la cancelación.') + ' Actualiza antes de reintentar.'
          : '<strong>No se canceló.</strong> ' + h(j.error || ('Respuesta ' + r.status + '.'));
        if (dueno.alCancelar) dueno.alCancelar();
        return Promise.all([dueno.listar(), dueno.verDetalle(d.numero)]).then(function () {
          msg(ok ? 'listo' : j.cancelada === null ? 'aviso' : 'error', html);
          return r;
        });
      }, function () {
        dueno.ocupado = false;
        msg('aviso', 'No se pudo contactar al servidor: no se sabe si se canceló. Actualiza antes de reintentar.');
        return null;
      });
  }

  class RegistroSolicitudesNuevas {
    // pedir(url, op) -> Promise<Response> (fetch por omision).
    constructor(doc, pedir) {
      this.doc = doc;
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.rol = null;
      this.vista = 'cambio';     // 'nuevas' | 'cambio' (la de siempre, de inicio)
      this.filtro = 'ENVIADA';   // snFiltro: Pendientes por omision ('' = todas)
      this.detalle = null;
      this.ocupado = false;      // una revision a la vez (doble clic)
      this.alVerCambio = null;   // al volver a "Cambios": la pagina relee esa cola
      this.alVerSolicitud = null; // (d) se abrio el detalle: el aviso la marca vista
      this.alRevisar = null;      // tras aprobar / rechazar: el aviso se relee
      this.alModificar = null;    // (d) -> true si abrio Nueva solicitud para corregir una suya (sql/42)
      this.alCancelar = null;     // tras cancelar una suya: el aviso se relee
      this.alVerIniciativa = null; // (codigo, boton) -> { estado, mensaje }: la iniciativa creada, sin cambiar de pestaña
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    fijarRol(rol) { this.rol = rol === 'ADM' || rol === 'MOD' ? rol : null; }

    cablear() {
      if (this.cableado || !this.$('snBloque')) return;
      this.cableado = true;
      var self = this;
      this.$('solVerNuevas').addEventListener('click', function () { self.verNuevas(); });
      this.$('solVerCambio').addEventListener('click', function () { self.verCambio(); });
      this.$('snFiltro').addEventListener('change', function (e) { self.filtro = e.target.value || ''; self.listar(); });
      this.$('snActualizar').addEventListener('click', function () { self.listar(); });
      this.$('snLista').addEventListener('click', function (e) {
        if (clicReferencia(e, self, function (t) { self.mensaje('snMsg', 'aviso', h(t)); })) return;
        var el = e.target && e.target.closest ? e.target.closest('[data-sn-numero]') : e.target;
        var n = el && el.getAttribute && el.getAttribute('data-sn-numero');
        if (n) self.verDetalle(Number(n));
      });
      this.$('snDetalle').addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-sn-accion]') : e.target;
        var a = el && el.getAttribute && el.getAttribute('data-sn-accion');
        if (a === 'aprobar') { self.aprobar(); return; }
        if (a === 'rechazar') { self.rechazar(); return; }
        if (a === 'cerrar') { self.cerrarDetalle(); return; }
        if (clicReferencia(e, self, function (t) { self.mensaje('snDetMsg', 'aviso', h(t)); })) return;
        // sql/42: ir a la relacionada; cancelar / modificar la suya.
        var ir = e.target && e.target.closest ? e.target.closest('[data-sn-ir]') : null;
        var n = ir && ir.getAttribute ? Number(ir.getAttribute('data-sn-ir')) : 0;
        if (n > 0) { self.verDetalle(n); return; }
        var sx = e.target && e.target.closest ? e.target.closest('[data-sx-accion]') : null;
        if (sx) accionPropia(self, sx.getAttribute('data-sx-accion'), 'sn');
      });
    }

    // Al mostrar la pestaña (despues de ColaSolicitudes.abrir). Sin ADM: ni
    // conmutador ni "Iniciativas"; "Cambios" se queda como la pinta su modulo.
    abrir() {
      this.cablear();
      if (!this.$('snBloque')) return Promise.resolve(null);
      var adm = this.rol === 'ADM';
      this.$('solVistas').hidden = !adm;
      if (!adm) {
        this.$('snBloque').hidden = true;
        this.$('solVistaCambio').hidden = false;
        return Promise.resolve(null);
      }
      this.aplicarVista();
      return this.vista === 'nuevas' ? this.listar() : Promise.resolve(null);
    }

    aplicarVista() {
      var nuevas = this.vista === 'nuevas', self = this;
      this.$('snBloque').hidden = !nuevas;
      this.$('solVistaCambio').hidden = nuevas;
      [['solVerNuevas', nuevas], ['solVerCambio', !nuevas]].forEach(function (par) {
        self.$(par[0]).classList.toggle('activa', par[1]);
        self.$(par[0]).setAttribute('aria-pressed', par[1] ? 'true' : 'false');
      });
    }

    verNuevas() {
      if (this.rol !== 'ADM') return Promise.resolve(null);
      this.vista = 'nuevas';
      this.aplicarVista();
      return this.listar();
    }

    verCambio() {
      this.vista = 'cambio';
      this.aplicarVista();
      if (this.alVerCambio) this.alVerCambio();
    }

    mensaje(id, clase, html) {
      var m = this.$(id);
      if (!m) return;
      m.className = 'ini-cambio-msg ' + clase;
      m.innerHTML = html;
    }

    // fondo: el refresco automatico (RefrescoAuto), como en la cola de
    // cambios: sin "Cargando…", una falla (que no sea 401 / 403) no borra
    // la lista que se ve, y una respuesta vieja nunca pisa a la nueva.
    listar(fondo) {
      var self = this, mia = this.lecturas = (this.lecturas || 0) + 1;
      if (!fondo) {
        this.mensaje('snMsg', '', '<span>Cargando solicitudes nuevas…</span>');
        this.$('snResumen').textContent = '';
      }
      var url = URL + '?accion=listar' + (this.filtro ? '&estado=' + encodeURIComponent(this.filtro) : '');
      var vacio = this.filtro ? 'No hay solicitudes nuevas con ese estado.' : null;
      return Promise.resolve().then(function () { return self.pedir(url, { cache: 'no-store', credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          if (mia !== self.lecturas) return null;
          self.ultimoEstado = r.status;
          if (r.status === 200 && Array.isArray(r.json.solicitudes)) {
            self.$('snLista').innerHTML = htmlLista(r.json.solicitudes, vacio, !!self.alVerIniciativa);
            self.$('snResumen').textContent = textoTotal(r.json);
            self.mensaje('snMsg', '', '');
            return r.json.solicitudes;
          }
          if (fondo && r.status !== 401 && r.status !== 403) {
            self.mensaje('snMsg', 'aviso', 'No se pudo actualizar la lista (respuesta ' + h(r.status) + '): se muestra la última lectura.');
            return null;
          }
          self.$('snLista').innerHTML = '';
          var e = textoError(r.status, r.json, 'las solicitudes');
          self.mensaje('snMsg', e.clase, e.html);
          return null;
        }, function () {
          if (mia !== self.lecturas) return null;
          self.ultimoEstado = null;
          if (fondo) {
            self.mensaje('snMsg', 'aviso', 'No se pudo actualizar la lista (sin conexión): se muestra la última lectura.');
            return null;
          }
          self.$('snLista').innerHTML = '';
          self.mensaje('snMsg', 'error', 'No se pudo contactar al servidor.');
          return null;
        });
    }

    // RefrescoAuto: solo con la vista "Iniciativas" a la vista (ADM), sin
    // un detalle abierto, sin revision en curso y sin nadie escribiendo o
    // eligiendo en la pestaña.
    puedeRefrescar() {
      var bloque = this.$('snBloque'), panel = this.$('panel-solicitudes');
      return this.cableado && this.rol === 'ADM' && this.vista === 'nuevas' && !!bloque && !bloque.hidden && !(panel && panel.hidden) &&
        !this.detalle && !this.ocupado && !(window.RefrescoAuto && window.RefrescoAuto.editando(this.doc, panel));
    }
    refrescarFondo() {
      var self = this;
      return this.listar(true).then(function () { return self.ultimoEstado; });
    }

    verDetalle(numero) {
      var self = this;
      this.mensaje('snMsg', '', '<span>Cargando la solicitud…</span>');
      return Promise.resolve().then(function () {
        return self.pedir(URL + '?accion=detalle&numero=' + encodeURIComponent(numero), { cache: 'no-store', credentials: 'same-origin' });
      })
        .then(leer)
        .then(function (r) {
          if (r.status !== 200) {
            var e = textoError(r.status, r.json, 'la solicitud');
            self.mensaje('snMsg', e.clase, e.html);
            return null;
          }
          self.mensaje('snMsg', '', '');
          self.detalle = r.json;
          var caja = self.$('snDetalle');
          caja.innerHTML = htmlDetalle(r.json, self.rol === 'ADM' && r.json.revision_disponible === true, undefined, !!self.alVerIniciativa);
          caja.hidden = false;
          if (self.alVerSolicitud) self.alVerSolicitud(r.json);
          return r.json;
        }, function () {
          self.mensaje('snMsg', 'error', 'No se pudo contactar al servidor.');
          return null;
        });
    }

    cerrarDetalle() {
      this.detalle = null;
      this.$('snDetalle').hidden = true;
      this.$('snDetalle').innerHTML = '';
    }

    comentario() { var c = this.$('snComentario'); return c ? String(c.value || '').trim() : ''; }

    // null = sin elegir; '' = "sin estado" elegido a proposito; o el Estado.
    estadoInicial() {
      var e = this.$('snEstado');
      var v = e ? String(e.value || '') : '';
      return v === '' ? null : v === SIN_ESTADO ? '' : v;
    }

    aprobar() { return this.revisar('aprobar', 'aprobada'); }

    rechazar() {
      if (this.detalle && !this.comentario()) {
        this.mensaje('snDetMsg', 'error', 'Escribe por qué se rechaza.');
        return Promise.resolve(null);
      }
      return this.revisar('rechazar', 'rechazada');
    }

    // POST al endpoint de revision (nunca al de Cambios). Despues se releen
    // lista y detalle: la verdad es la del servidor (quien gano, el estado).
    revisar(accion, exito) {
      var self = this, d = this.detalle;
      if (!d || this.ocupado || d.estado !== 'ENVIADA') return Promise.resolve(null);
      var comentario = this.comentario();
      if (comentario.length > MAXIMO_COMENTARIO) {
        this.mensaje('snDetMsg', 'error', 'El comentario no puede pasar de ' + MAXIMO_COMENTARIO + ' caracteres.');
        return Promise.resolve(null);
      }
      var estadoIni = accion === 'aprobar' ? this.estadoInicial() : null;
      if (accion === 'aprobar' && estadoIni === null) {
        this.mensaje('snDetMsg', 'error', 'Elige el Estado inicial de la iniciativa (o «Sin estado»).');
        return Promise.resolve(null);
      }
      var datos = new FormData();
      datos.append('numero', String(d.numero));
      if (accion === 'aprobar') datos.append('estado', estadoIni);
      if (comentario) datos.append('comentario', comentario);
      this.ocupado = true;
      this.mensaje('snDetMsg', '', '<span>' + (accion === 'aprobar' ? 'Aprobando y creando la iniciativa…' : 'Rechazando…') + '</span>');
      return Promise.resolve().then(function () {
        return self.pedir(URL_REVISION + '?accion=' + accion, { method: 'POST', body: datos, credentials: 'same-origin' });
      })
        .then(leer)
        .then(function (r) {
          self.ocupado = false;
          var j = r.json, ok = r.status === 200 && j[exito] === true;
          // Aprobar sin el codigo del servidor no es exito: nunca se inventa.
          var sinCodigo = ok && accion === 'aprobar' && !(typeof j.codigo === 'string' && j.codigo);
          if (sinCodigo) ok = false;
          var html = ok
            ? (accion === 'aprobar'
                ? '<strong>Solicitud aceptada. Iniciativa creada con el código: ' + h(j.codigo) + '</strong>' +
                  (j.iniciativa_nueva === false ? ' Ya estaba creada: no se creó otra.' : '') +
                  (Array.isArray(j.faltantes) && j.faltantes.length
                    ? '<span class="ini-sub">Queda Incompleta: falta ' + j.faltantes.map(function (f) { return h(f.rotulo || f.clave); }).join(', ') + '.</span>'
                    : '')
                : '<strong>Solicitud ' + h(d.numero_texto) + ' rechazada.</strong>')
            : sinCodigo ? 'El servidor no devolvió el código de la iniciativa. Revisa la solicitud antes de reintentar.'
            : j[exito] === null ? h(j.error || 'No se pudo confirmar.') + ' Revisa la solicitud antes de reintentar.'
            : '<strong>No se ' + (accion === 'aprobar' ? 'aprobó' : 'rechazó') + '.</strong> ' + h(j.error || ('Respuesta ' + r.status + '.')) +
              (Array.isArray(j.errores) && j.errores.length
                ? '<span class="ini-sub">' + j.errores.map(function (e) { return h(e.mensaje); }).join(' ') + '</span>' : '');
          var clase = ok ? 'listo' : (sinCodigo || j[exito] === null) ? 'aviso' : 'error';
          if (self.alRevisar) self.alRevisar();
          return Promise.all([self.listar(), self.verDetalle(d.numero)]).then(function () {
            self.mensaje('snDetMsg', clase, html);
            return r;
          });
        }, function () {
          self.ocupado = false;
          self.mensaje('snDetMsg', 'aviso', 'No se pudo contactar al servidor: no se sabe si se ' + (accion === 'aprobar' ? 'aprobó' : 'rechazó') +
            '. Actualiza la lista antes de reintentar.');
          return null;
        });
    }
  }

  // "Mis solicitudes": para quien puede solicitar y no es ADM, las que envio
  // su propia cuenta (#msBloque), solo lectura: lista y detalle con su
  // historial, sin aprobar ni rechazar. El servidor decide de quien son
  // (admin_iniciativas_mis_solicitudes.ashx: la cuenta de IIS) y quien
  // puede verlas (ExigirSolicitud); aqui solo se elige el Estado (msFiltro,
  // 2026-11-04), que tambien filtra el servidor dentro de la cuenta.
  class MisSolicitudes {
    constructor(doc, pedir) {
      this.doc = doc;
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.cableado = false;
      this.filtro = '';          // msFiltro: Todas por omision (como antes del filtro)
      this.detalle = null;       // la abierta (Cancelar / Modificar, sql/42)
      this.ocupado = false;
      this.alModificar = null;   // (d) -> true si abrio Nueva solicitud para corregirla
      this.alVerIniciativa = null; // (codigo, boton) -> { estado, mensaje }: la iniciativa creada, sin cambiar de pestaña
    }

    $(id) { return this.doc.getElementById(id); }

    cablear() {
      if (this.cableado || !this.$('msBloque')) return;
      this.cableado = true;
      var self = this;
      this.$('msActualizar').addEventListener('click', function () { self.listar(); });
      if (this.$('msFiltro')) {
        this.$('msFiltro').value = this.filtro;
        this.$('msFiltro').addEventListener('change', function (e) { self.filtro = e.target.value || ''; self.cerrarDetalle(); self.listar(); });
      }
      this.$('msLista').addEventListener('click', function (e) {
        if (clicReferencia(e, self, function (t) { self.mensaje('aviso', h(t)); })) return;
        var el = e.target && e.target.closest ? e.target.closest('[data-sn-numero]') : e.target;
        var n = el && el.getAttribute && el.getAttribute('data-sn-numero');
        if (n) self.verDetalle(Number(n));
      });
      this.$('msDetalle').addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-sn-accion]') : e.target;
        if (el && el.getAttribute && el.getAttribute('data-sn-accion') === 'cerrar') { self.cerrarDetalle(); return; }
        if (clicReferencia(e, self, function (t) { var m = self.$('msDetMsg'); if (m) { m.className = 'ini-cambio-msg aviso'; m.innerHTML = h(t); } })) return;
        // sql/42: ir a la relacionada (de la misma cuenta); cancelar / modificar.
        var ir = e.target && e.target.closest ? e.target.closest('[data-sn-ir]') : null;
        var n = ir && ir.getAttribute ? Number(ir.getAttribute('data-sn-ir')) : 0;
        if (n > 0) { self.verDetalle(n); return; }
        var sx = e.target && e.target.closest ? e.target.closest('[data-sx-accion]') : null;
        if (sx) accionPropia(self, sx.getAttribute('data-sx-accion'), 'ms');
      });
    }

    abrir() {
      this.cablear();
      if (!this.$('msBloque')) return Promise.resolve(null);
      this.$('msBloque').hidden = false;
      return this.listar();
    }

    // Sin acceso (ADM, o ya no puede solicitar): oculto y sin lo leido.
    ocultar() {
      if (!this.$('msBloque')) return;
      this.$('msBloque').hidden = true;
      this.$('msLista').innerHTML = '';
      this.$('msResumen').textContent = '';
      this.mensaje('');
      this.cerrarDetalle();
    }

    mensaje(clase, html) {
      var m = this.$('msMsg');
      if (!m) return;
      m.className = 'ini-cambio-msg ' + clase;
      m.innerHTML = html || '';
    }

    // fondo: el refresco automatico, con las mismas reglas que las otras
    // dos listas de la pestaña.
    listar(fondo) {
      var self = this, mia = this.lecturas = (this.lecturas || 0) + 1, filtro = this.filtro;
      if (!fondo) {
        this.mensaje('', '<span>Cargando tus solicitudes…</span>');
        this.$('msResumen').textContent = '';
      }
      var url = URL_MIAS + '?accion=listar' + (filtro ? '&estado=' + encodeURIComponent(filtro) : '');
      return Promise.resolve().then(function () { return self.pedir(url, { cache: 'no-store', credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          if (mia !== self.lecturas) return null;
          self.ultimoEstado = r.status;
          if (r.status === 200 && Array.isArray(r.json.solicitudes)) {
            self.$('msLista').innerHTML = htmlLista(r.json.solicitudes,
              filtro ? 'No tienes solicitudes de iniciativa con ese estado.' : 'Todavía no has enviado solicitudes de iniciativa.', !!self.alVerIniciativa);
            self.$('msResumen').textContent = textoTotal(r.json);
            self.mensaje('', '');
            return r.json.solicitudes;
          }
          if (fondo && r.status !== 401 && r.status !== 403) {
            self.mensaje('aviso', 'No se pudo actualizar la lista (respuesta ' + h(r.status) + '): se muestra la última lectura.');
            return null;
          }
          self.$('msLista').innerHTML = '';
          var e = textoError(r.status, r.json, 'tus solicitudes');
          self.mensaje(e.clase, e.html);
          return null;
        }, function () {
          if (mia !== self.lecturas) return null;
          self.ultimoEstado = null;
          if (fondo) {
            self.mensaje('aviso', 'No se pudo actualizar la lista (sin conexión): se muestra la última lectura.');
            return null;
          }
          self.$('msLista').innerHTML = '';
          self.mensaje('error', 'No se pudo contactar al servidor.');
          return null;
        });
    }

    // RefrescoAuto: con "Mis solicitudes" a la vista, sin un detalle abierto
    // y sin nadie escribiendo o eligiendo en la pestaña.
    puedeRefrescar() {
      var bloque = this.$('msBloque'), panel = this.$('panel-solicitudes'), det = this.$('msDetalle');
      return this.cableado && !!bloque && !bloque.hidden && !(panel && panel.hidden) && !(det && !det.hidden) &&
        !(window.RefrescoAuto && window.RefrescoAuto.editando(this.doc, panel));
    }
    refrescarFondo() {
      var self = this;
      return this.listar(true).then(function () { return self.ultimoEstado; });
    }

    verDetalle(numero) {
      var self = this;
      this.mensaje('', '<span>Cargando la solicitud…</span>');
      return Promise.resolve().then(function () {
        return self.pedir(URL_MIAS + '?accion=detalle&numero=' + encodeURIComponent(numero), { cache: 'no-store', credentials: 'same-origin' });
      })
        .then(leer)
        .then(function (r) {
          if (r.status !== 200) {
            var e = textoError(r.status, r.json, 'la solicitud');
            self.mensaje(e.clase, e.html);
            return null;
          }
          self.mensaje('', '');
          self.detalle = r.json;
          var caja = self.$('msDetalle');
          caja.innerHTML = htmlDetalle(r.json, false, 'ms', !!self.alVerIniciativa);
          caja.hidden = false;
          return r.json;
        }, function () {
          self.mensaje('error', 'No se pudo contactar al servidor.');
          return null;
        });
    }

    cerrarDetalle() {
      this.detalle = null;
      var caja = this.$('msDetalle');
      if (!caja) return;
      caja.hidden = true;
      caja.innerHTML = '';
    }
  }

  return { RegistroSolicitudesNuevas: RegistroSolicitudesNuevas, MisSolicitudes: MisSolicitudes, htmlLista: htmlLista, htmlDetalle: htmlDetalle,
           textoError: textoError, textoTotal: textoTotal, URL: URL, URL_REVISION: URL_REVISION, URL_MIAS: URL_MIAS, SIN_ESTADO: SIN_ESTADO,
           URL_VALIDAR: URL_VALIDAR, accionPropia: accionPropia, ESTADOS: ESTADOS };
})();
