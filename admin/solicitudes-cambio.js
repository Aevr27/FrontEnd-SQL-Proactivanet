/* =========================================================================
   admin/solicitudes-cambio.js - cola de ADM de "Solicitar cambios"
   (pestaña Solicitudes). handlers/admin_iniciativas_solicitudes.ashx.

     listar   GET  ?accion=listar&estado=   (PENDIENTE por omision)
     detalle  GET  ?accion=detalle&id=      antes / pedido / actual, etapa de
                                            la fecha, categorias, eventos,
                                            ultimo error, "desactualizada"
     aplicar  POST ?accion=aplicar          id, comentario, clas_* (solo las
                                            categorias por agregar sin
                                            clasificacion)
     rechazar POST ?accion=rechazar         id, comentario (obligatorio)

   Solo UX: el servidor exige ADM en todo esto (AccesoAdmin.ExigirAdm) y
   pone quien revisa. Con otro rol la pestaña solo explica. "Aplicada" o
   "rechazada" se dice SOLO con la respuesta del servidor; una falla deja la
   solicitud pendiente y se muestra el motivo que dio el servidor.
   Se prueba en node: tools/tests/SolicitudesCambioColaSmoke.js.
   ========================================================================= */
window.SolicitudesCambioCola = (function () {
  'use strict';

  var URL = '../handlers/admin_iniciativas_solicitudes.ashx';
  var TIPOS = { FECHA: 'Fecha compromiso', ESTADO: 'Estado y Subestado', CATEGORIAS: 'Categorías', OTROS: 'Otros (explicación)',
                DATOS: 'Título / Product Owner / Service Owner', VARIOS: 'Varios cambios' };
  // VARIOS (sql/34): las fechas pedidas, cada una con su etapa.
  function fechasVarias(s) { return Array.isArray(s.fechas_varias) ? s.fechas_varias : []; }
  // DATOS (sql/25): cada dato con su bandera; PO / SO son los CAPTURADOS de
  // la iniciativa (no los de la categoría). null = vacío.
  var DATOS = [
    { clave: 'titulo', rotulo: 'Título' },
    { clave: 'po', rotulo: 'Product Owner capturado' },
    { clave: 'so', rotulo: 'Service Owner capturado' }
  ];
  function datosPedidos(s) { return DATOS.filter(function (x) { return s['cambia_' + x.clave] === true; }); }
  function vacio(v) { return v === null || v === undefined || v === '' ? '(vacío)' : v; }
  var ESTADOS = { PENDIENTE: 'Pendiente', APLICADA: 'Aplicada', RECHAZADA: 'Rechazada' };
  var EVENTOS = { ENVIADA: 'Enviada', APLICADA: 'Aplicada', RECHAZADA: 'Rechazada', FALLO_APLICAR: 'Falló al aplicar', DESACTUALIZADA: 'Desactualizada' };

  function h(s) { return Escape.html(s === null || s === undefined ? '' : String(s)); }
  function fecha(iso) { return iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—'; }
  // "aaaa-mm-ddThh:mm:ssZ" (UTC) -> hora local legible.
  function fechaHora(utc) {
    if (!utc) return '—';
    var d = new Date(utc);
    if (isNaN(d.getTime())) return h(utc);
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    return dos(d.getDate()) + '/' + dos(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + dos(d.getHours()) + ':' + dos(d.getMinutes());
  }
  function pct(v) { return v === null || v === undefined ? '—' : h(v) + '%'; }

  // Lo pedido, en una linea (HTML). La fecha dice SIEMPRE su etapa.
  function resumen(s) {
    var fechaTxt = s.campo_fecha ? 'Fecha compromiso de ' + h(s.etapa) + ': ' + fecha(s.fecha_anterior) + ' → ' + fecha(s.fecha_nueva) : '';
    if (s.tipo === 'FECHA') return fechaTxt;
    if (s.tipo === 'ESTADO') {
      return h(s.estado_anterior || '—') + (s.subestado_anterior ? ' / ' + h(s.subestado_anterior) : '') + ' → ' +
        h(s.estado_nuevo) + (s.subestado_nuevo ? ' / ' + h(s.subestado_nuevo) : '') + (fechaTxt ? '; ' + fechaTxt : '');
    }
    if (s.tipo === 'CATEGORIAS') return h(s.categorias) + ' categoría' + (s.categorias === 1 ? '' : 's') + (s.sin_clasificar ? ' (' + h(s.sin_clasificar) + ' sin clasificar)' : '');
    if (s.tipo === 'DATOS') {
      return datosPedidos(s).map(function (x) {
        return h(x.rotulo) + ': ' + h(vacio(s[x.clave + '_anterior'])) + ' → ' + h(vacio(s[x.clave + '_nuevo']));
      }).join('; ');
    }
    // VARIOS: cada cambio en su renglon del resumen; se aprueba o se
    // rechaza la solicitud completa.
    if (s.tipo === 'VARIOS') {
      var partes = [];
      if (s.estado_nuevo) {
        partes.push('Estado: ' + h(s.estado_anterior || '—') + ' → ' + h(s.estado_nuevo) + (s.subestado_nuevo ? ' / ' + h(s.subestado_nuevo) : ''));
      }
      fechasVarias(s).forEach(function (x) {
        partes.push('Fecha compromiso de ' + h(x.etapa) + ': ' + fecha(x.anterior) + ' → ' + fecha(x.nueva));
      });
      if (s.categorias) partes.push(h(s.categorias) + ' categoría' + (s.categorias === 1 ? '' : 's') + (s.sin_clasificar ? ' (' + h(s.sin_clasificar) + ' sin clasificar)' : ''));
      datosPedidos(s).forEach(function (x) {
        partes.push(h(x.rotulo) + ': ' + h(vacio(s[x.clave + '_anterior'])) + ' → ' + h(vacio(s[x.clave + '_nuevo'])));
      });
      return partes.join('; ');
    }
    return 'Explicación para ADM';
  }

  // Quien envio: el nombre de CatPersona que resolvio el servidor
  // (solicitante_nombre); sin el, la cuenta Windows guardada (solicitado_por).
  function quien(s) { return h(s.solicitante_nombre || s.solicitado_por); }

  // conIniciativa: el Codigo es un boton que abre el detalle de la
  // iniciativa (data-sol-folio); sin el, texto como antes. El "#" sigue
  // abriendo la solicitud (data-sol-id).
  function htmlLista(lista, conIniciativa) {
    if (!lista.length) return '<p class="ini-nota">No hay solicitudes con ese estado.</p>';
    return '<table class="ini-det-tabla ini-sol-tabla"><thead><tr><th scope="col">#</th><th scope="col">Iniciativa</th>' +
      '<th scope="col">Qué cambia</th><th scope="col">Pedido</th><th scope="col">Solicitó</th><th scope="col">Enviada</th>' +
      '<th scope="col">Estado</th></tr></thead><tbody>' +
      lista.map(function (s) {
        return '<tr class="ini-sol-fila" data-sol-id="' + h(s.id) + '">' +
          '<td><button type="button" class="ini-folio" data-sol-id="' + h(s.id) + '">#' + h(s.id) + '</button></td>' +
          '<td>' + (conIniciativa && s.folio
            ? '<button type="button" class="ini-folio" data-sol-folio="' + h(s.folio) + '" title="Ver la iniciativa">' + h(s.folio) + '</button>'
            : h(s.folio)) + (s.titulo ? '<span class="ini-sub">' + h(s.titulo) + '</span>' : '') + '</td>' +
          '<td>' + h(TIPOS[s.tipo] || s.tipo) + '</td><td>' + resumen(s) + '</td>' +
          '<td>' + quien(s) + ' <span class="chip ini-chip">' + h(s.rol_solicitante) + '</span>' +
            (s.solicitante_nombre && s.solicitado_por ? '<span class="ini-sub">' + h(s.solicitado_por) + '</span>' : '') + '</td>' +
          '<td>' + fechaHora(s.fecha_solicitud_utc) + '</td>' +
          '<td>' + h(ESTADOS[s.estado] || s.estado) +
            (s.estado === 'PENDIENTE' && s.intentos > 0 ? ' <span class="pill ini-atrasada" title="' + h(s.ultimo_error) + '">' + h(s.intentos) + ' intento' + (s.intentos === 1 ? '' : 's') + '</span>' : '') +
          '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  function opciones(valores, elegido) {
    return '<option value="">— Elige —</option>' + (valores || []).map(function (v) {
      return '<option value="' + h(v) + '"' + (v === elegido ? ' selected' : '') + '>' + h(v) + '</option>';
    }).join('');
  }

  // IMPACTO POR CATEGORIA (estimado): la volumetria de HOY de cada ruta
  // (SLOT 0, ultimos 30 dias: la de Nueva solicitud y Solicitar cambios,
  // VolumetriaCliente), los tickets que da el % pedido con ticketsDe de
  // admin/iniciativas.js (FLOOR) y las OTRAS iniciativas activas de la
  // categoria (otras_iniciativas del servidor: CapacidadCategoria.Otras, sin
  // la iniciativa de la solicitud) con su % y lo ya comprometido. Nada de
  // esto se guarda: al aplicar, la base calcula Tickets a reducir con su
  // propia ventana y redondeo.
  //   vols: ruta -> { estado, valor } (undefined = todavia no se pide)
  function volTexto(v) {
    if (!v || v.estado === 'cargando') return 'Calculando…';
    if (v.estado === 'ok' || v.estado === 'cero') return h(Number(v.valor).toLocaleString('es-MX'));
    return '—';
  }
  function ticketsTexto(v, pctPedido) {
    var I = window.Iniciativas;
    if (!v || (v.estado !== 'ok' && v.estado !== 'cero') || !I || typeof I.ticketsDe !== 'function') return '—';
    if (pctPedido === null || pctPedido === undefined || pctPedido === '') return '—';
    var t = I.ticketsDe(v.valor, String(pctPedido));
    return t === null || t === undefined ? '—' : h(t);
  }
  function htmlOtrasCategoria(c) {
    var otras = c.otras_iniciativas;
    if (otras === undefined) return '';
    if (!Array.isArray(otras)) return '<p class="ini-nota">No se pudieron leer las otras iniciativas de ' + h(c.categoria) + '.</p>';
    var suma = 0;
    otras.forEach(function (o) { if (typeof o.pct === 'number') suma += Math.round(o.pct * 10000); });
    var pedido = Math.round(Number(c.pct_nuevo) * 100);
    var conPedido = isFinite(pedido) ? (suma + pedido) / 100 : null;
    var lista = otras.length
      ? '<table class="ini-det-tabla"><thead><tr><th scope="col">Iniciativa</th><th scope="col" class="num">% de disminución</th>' +
        '<th scope="col">Estado</th></tr></thead><tbody>' +
        otras.map(function (o) {
          return '<tr><td>' + h(o.folio) + '</td><td class="num">' + (typeof o.pct === 'number' ? h(Math.round(o.pct * 10000) / 100) + '%' : '—') +
            '</td><td>' + (o.estado ? h(o.estado) : '—') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<p class="ini-nota">Ninguna otra iniciativa activa tiene % en esta categoría.</p>';
    return '<h6 class="ini-cat-ruta">' + h(c.categoria) + '</h6>' + lista +
      '<p class="ini-nota">Ya comprometido por otras: ' + h(suma / 100) + '%' +
      (conPedido === null ? '' : ' · con el % pedido aquí: ' + h(conPedido) + '%') + '.</p>';
  }
  function htmlImpacto(cats, vols) {
    if (!cats.length) return '';
    vols = vols || {};
    return '<h5>Impacto por categoría <span class="ini-sub">estimado con la volumetría de hoy</span></h5>' +
      '<table class="ini-det-tabla"><thead><tr><th scope="col">Categoría</th><th scope="col" class="num">% pedido</th>' +
      '<th scope="col" class="num">Volumetría <span class="ini-sub">hoy, últimos 30 días</span></th>' +
      '<th scope="col" class="num">Tickets a reducir <span class="ini-sub">estimado</span></th></tr></thead><tbody>' +
      cats.map(function (c, n) {
        var v = vols[c.categoria];
        return '<tr><td class="ini-cat-ruta">' + h(c.categoria) + '</td><td class="num">' + pct(c.pct_nuevo) + '</td>' +
          '<td class="num" id="solVol-' + n + '">' + volTexto(v) + '</td>' +
          '<td class="num" id="solTk-' + n + '">' + ticketsTexto(v, c.pct_nuevo) + '</td></tr>';
      }).join('') + '</tbody></table>' +
      '<p class="ini-nota">Estimación: al aplicar, la base recalcula Tickets a reducir con su propia ventana de 30 días y su redondeo.</p>' +
      (cats.some(function (c) { return c.otras_iniciativas !== undefined; })
        ? '<h5>Otras iniciativas activas en cada categoría</h5>' + cats.map(htmlOtrasCategoria).join('') : '');
  }

  // tipos: { iniciativa: [...], agrupado: [...] } (los valores que ya existen).
  // vols: la volumetria de hoy por ruta (htmlImpacto); opcional.
  function htmlDetalle(d, tipos, vols) {
    tipos = tipos || {};
    var pendiente = d.estado === 'PENDIENTE';
    var act = d.actual || {};
    var filas = '';
    if (d.tipo === 'ESTADO' || (d.tipo === 'VARIOS' && d.estado_nuevo)) {
      filas += '<tr><th scope="row">Estado / Subestado</th><td>' + h(d.estado_anterior || '—') + (d.subestado_anterior ? ' / ' + h(d.subestado_anterior) : '') +
        '</td><td>' + h(d.estado_nuevo) + (d.subestado_nuevo ? ' / ' + h(d.subestado_nuevo) : ' <span class="ini-nota">(Subestado sin cambio)</span>') +
        '</td><td>' + h(act.estado || '—') + (act.subestado ? ' / ' + h(act.subestado) : '') + '</td></tr>';
    }
    if (d.campo_fecha) {
      filas += '<tr><th scope="row">Fecha compromiso de ' + h(d.etapa) + '</th><td>' + fecha(d.fecha_anterior) + '</td><td>' + fecha(d.fecha_nueva) +
        '</td><td>' + fecha(d.fecha_actual) + '</td></tr>';
    }
    fechasVarias(d).forEach(function (x) {
      filas += '<tr><th scope="row">Fecha compromiso de ' + h(x.etapa) + '</th><td>' + fecha(x.anterior) + '</td><td>' + fecha(x.nueva) +
        '</td><td>' + fecha(x.actual) + '</td></tr>';
    });
    if (d.tipo === 'DATOS' || d.tipo === 'VARIOS') {
      datosPedidos(d).forEach(function (x) {
        filas += '<tr><th scope="row">' + h(x.rotulo) + '</th><td>' + h(vacio(d[x.clave + '_anterior'])) + '</td><td>' +
          h(vacio(d[x.clave + '_nuevo'])) + '</td><td>' + h(vacio(act[x.clave])) + '</td></tr>';
      });
    }
    var cambios = filas ? '<table class="ini-det-tabla"><thead><tr><th scope="col">Campo</th><th scope="col">Al enviar</th>' +
      '<th scope="col">Pedido</th><th scope="col">Ahora</th></tr></thead><tbody>' + filas + '</tbody></table>' : '';
    var cats = (d.categorias_detalle || []);
    var htmlCats = cats.length ? '<h5>Categorías</h5><table class="ini-det-tabla"><thead><tr><th scope="col">Categoría</th><th scope="col">Acción</th>' +
      '<th scope="col">% al enviar</th><th scope="col">% pedido</th><th scope="col">% ahora</th><th scope="col">Clasificación</th></tr></thead><tbody>' +
      cats.map(function (c, n) {
        var sinClas = c.accion === 'AGREGAR' && (!c.tipo_iniciativa || !c.tipo_agrupado);
        var clas = c.accion !== 'AGREGAR' ? '<span class="ini-nota">no cambia</span>'
          : !sinClas ? h(c.tipo_iniciativa) + ' / ' + h(c.tipo_agrupado)
          : pendiente
            ? '<span class="ini-sol-clas" data-clas-fila="' + n + '"><label>Tipo de iniciativa <select data-clas-ti="' + n + '" data-clas-categoria="' + h(c.categoria) + '">' + opciones(tipos.iniciativa) + '</select></label> ' +
              '<label>Agrupación <select data-clas-ta="' + n + '">' + opciones(tipos.agrupado) + '</select></label></span>'
            : '<span class="ini-nota">sin clasificar</span>';
        return '<tr><td class="ini-cat-ruta">' + h(c.categoria) + '</td><td>' + (c.accion === 'AGREGAR' ? 'Agregar' : 'Cambiar %') + '</td>' +
          '<td class="num">' + pct(c.pct_anterior) + '</td><td class="num">' + pct(c.pct_nuevo) + '</td><td class="num">' +
          (c.accion === 'AGREGAR' ? (c.ligada_alguna_vez ? 'ya ligada' : '—') : (c.ligada ? pct(c.pct_actual) : 'ya no ligada')) + '</td><td>' + clas + '</td></tr>';
      }).join('') + '</tbody></table>' : '';
    var avisos = '';
    if (pendiente && d.tipo === 'VARIOS') {
      avisos += '<p class="ini-cambio-msg aviso"><strong>Varios cambios, una sola decisión:</strong> aplicar aplica TODOS los cambios de arriba ' +
        '(o ninguno, si alguno falla); rechazar no aplica ninguno.</p>';
    }
    if (pendiente && d.desactualizada) {
      avisos += '<p class="ini-cambio-msg error"><strong>Desactualizada:</strong> la iniciativa cambió desde que se envió (compara «Al enviar» con «Ahora»). ' +
        'No se puede aplicar tal cual: recházala o pide que la envíen de nuevo.</p>';
    }
    if (pendiente && d.ultimo_error) {
      avisos += '<p class="ini-cambio-msg aviso"><strong>Último intento (' + fechaHora(d.fecha_ultimo_intento_utc) + '):</strong> ' + h(d.ultimo_error) + '</p>';
    }
    if (pendiente && cats.some(function (c) { return c.accion === 'AGREGAR' && (!c.tipo_iniciativa || !c.tipo_agrupado); })) {
      avisos += '<p class="ini-cambio-msg aviso">Una categoría por agregar llegó sin clasificación (su prefijo no tiene regla o el valor no existe): elígela antes de aplicar.</p>';
    }
    var eventos = (d.eventos || []).map(function (e) {
      return '<li><strong>' + h(EVENTOS[e.evento] || e.evento) + '</strong> · ' + fechaHora(e.fecha_utc) + ' · ' + h(e.usuario) +
        (e.detalle ? '<span class="ini-sub">' + h(e.detalle) + '</span>' : '') + '</li>';
    }).join('');
    var revision = d.estado !== 'PENDIENTE'
      ? '<p class="ini-nota">' + h(ESTADOS[d.estado]) + ' por ' + h(d.revisado_por) + ' el ' + fechaHora(d.fecha_revision_utc) +
        (d.comentario_revision ? ': «' + h(d.comentario_revision) + '»' : '') + '</p>'
      : '';
    var acciones = pendiente
      ? '<div class="ini-cambio-campos"><div class="campo ini-cambio-ancho"><label for="solComentario">' + (d.tipo === 'OTROS' ? 'Qué se corrigió (obligatorio para cerrarla)' : 'Comentario (obligatorio para rechazar)') +
        '</label><textarea id="solComentario" rows="3"></textarea></div></div>' +
        '<div class="ini-cambio-pie"><button type="button" class="btn chico" data-sol-accion="aplicar">' + (d.tipo === 'OTROS' ? 'Cerrar como atendida' : 'Aplicar solicitud') + '</button> ' +
        '<button type="button" class="btn linea chico" data-sol-accion="rechazar">Rechazar</button> ' +
        '<button type="button" class="btn linea chico" data-sol-accion="cerrar">Cerrar</button></div>'
      : '<div class="ini-cambio-pie"><button type="button" class="btn linea chico" data-sol-accion="cerrar">Cerrar</button></div>';
    return '<h4>Solicitud #' + h(d.id) + ' · ' + h(d.folio) + (d.titulo ? ' · ' + h(d.titulo) : '') + '</h4>' +
      '<p class="ini-nota">' + h(TIPOS[d.tipo] || d.tipo) + ' · la envió ' + quien(d) + ' (' + (d.solicitante_nombre && d.solicitado_por ? h(d.solicitado_por) + ', ' : '') + h(d.rol_solicitante) + ') el ' +
        fechaHora(d.fecha_solicitud_utc) + ' · ' + h(ESTADOS[d.estado] || d.estado) + (d.intentos ? ' · ' + h(d.intentos) + ' intento(s) de aplicar' : '') + '</p>' +
      avisos + cambios + htmlCats + htmlImpacto(cats, vols) +
      '<h5>Motivo</h5><div class="ini-texto">' + h(d.motivo) + '</div>' + revision +
      '<div class="ini-cambio-msg" id="solDetMsg" role="status" aria-live="polite"></div>' + acciones +
      (eventos ? '<h5>Historial de la solicitud</h5><ul class="ini-sol-eventos">' + eventos + '</ul>' : '');
  }

  function leer(resp) {
    return Promise.resolve(resp.json()).catch(function () { return null; }).then(function (j) { return { status: resp.status, json: j || {} }; });
  }

  class ColaSolicitudes {
    // pedir(url, op) -> Promise<Response> (fetch por omision). tipos() ->
    // { iniciativa, agrupado } para clasificar (del registro).
    constructor(doc, pedir, tipos) {
      this.doc = doc;
      this.pedir = pedir || function (url, op) { return fetch(url, op); };
      this.tipos = tipos || function () { return {}; };
      this.rol = null;
      this.filtro = 'PENDIENTE';
      this.detalle = null;      // la solicitud abierta (JSON del servidor)
      this.ocupado = false;
      this.alCambiarIniciativa = null;   // tras aplicar: releer el registro
      this.alVerSolicitud = null;        // (d) se abrio el detalle: el aviso la marca vista
      this.alRevisar = null;             // tras aplicar / rechazar: el aviso se relee
      this.alVerIniciativa = null;       // (folio) el Codigo de la lista: detalle de Iniciativas
      this.cableado = false;
    }

    $(id) { return this.doc.getElementById(id); }

    fijarRol(rol) { this.rol = rol === 'ADM' || rol === 'MOD' ? rol : null; }

    cablear() {
      if (this.cableado || !this.$('solCola')) return;
      this.cableado = true;
      var self = this;
      this.$('solFiltro').addEventListener('change', function (e) { self.filtro = e.target.value || ''; self.listar(); });
      this.$('solActualizar').addEventListener('click', function () { self.listar(); });
      this.$('solLista').addEventListener('click', function (e) {
        // El Codigo va antes que la fila: abre la iniciativa, no la solicitud.
        // Si no se puede abrir (false), sigue como un clic en la fila.
        var ini = e.target && e.target.closest ? e.target.closest('[data-sol-folio]') : null;
        if (ini && self.alVerIniciativa && self.alVerIniciativa(ini.getAttribute('data-sol-folio')) !== false) return;
        var el = e.target && e.target.closest ? e.target.closest('[data-sol-id]') : e.target;
        var id = el && el.getAttribute && el.getAttribute('data-sol-id');
        if (id) self.verDetalle(Number(id));
      });
      this.$('solDetalle').addEventListener('click', function (e) {
        var el = e.target && e.target.closest ? e.target.closest('[data-sol-accion]') : e.target;
        var a = el && el.getAttribute && el.getAttribute('data-sol-accion');
        if (a === 'aplicar') self.aplicar();
        else if (a === 'rechazar') self.rechazar();
        else if (a === 'cerrar') self.cerrarDetalle();
      });
    }

    // Al mostrar la pestaña.
    abrir() {
      this.cablear();
      var adm = this.rol === 'ADM';
      this.$('solCola').hidden = !adm;
      this.$('solNoAdm').hidden = adm;
      return adm ? this.listar() : Promise.resolve(null);
    }

    mensaje(id, clase, html) {
      var m = this.$(id);
      if (!m) return;
      m.className = 'ini-cambio-msg ' + clase;
      m.innerHTML = html;
    }

    // fondo: el refresco automatico (RefrescoAuto). Sin "Cargando…", y si
    // falla NO borra la lista que ya se ve: solo lo dice, discreto (un 401 /
    // 403 si sigue el camino de siempre: el acceso cambio). Una respuesta
    // vieja -otra lectura empezo despues: Actualizar, el filtro, el
    // refresco- nunca pisa a la nueva. this.ultimoEstado: el HTTP de la
    // ultima que se pinto (null = sin conexion).
    listar(fondo) {
      var self = this, mia = this.lecturas = (this.lecturas || 0) + 1;
      if (!fondo) this.mensaje('solMsg', '', '<span>Cargando solicitudes…</span>');
      var url = URL + '?accion=listar' + (this.filtro ? '&estado=' + encodeURIComponent(this.filtro) : '');
      return Promise.resolve().then(function () { return self.pedir(url, { cache: 'no-store', credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          if (mia !== self.lecturas) return null;
          self.ultimoEstado = r.status;
          if (r.status === 200 && Array.isArray(r.json.solicitudes)) {
            self.$('solLista').innerHTML = htmlLista(r.json.solicitudes, !!self.alVerIniciativa);
            self.mensaje('solMsg', '', '');
            return r.json.solicitudes;
          }
          if (fondo && r.status !== 401 && r.status !== 403) {
            self.mensaje('solMsg', 'aviso', 'No se pudo actualizar la cola (respuesta ' + h(r.status) + '): se muestra la última lectura.');
            return null;
          }
          self.$('solLista').innerHTML = '';
          self.mensaje('solMsg', r.status === 501 ? 'aviso' : 'error', h(r.json.error || ('No se pudo leer la cola (respuesta ' + r.status + ').')));
          return null;
        }, function () {
          if (mia !== self.lecturas) return null;
          self.ultimoEstado = null;
          self.mensaje('solMsg', fondo ? 'aviso' : 'error', fondo ? 'No se pudo actualizar la cola (sin conexión): se muestra la última lectura.'
            : 'No se pudo contactar al servidor.');
          return null;
        });
    }

    // RefrescoAuto: releer solo si la cola de ADM se ve, sin un detalle
    // abierto, sin aplicar / rechazar en curso y sin nadie escribiendo o
    // eligiendo en la pestaña (filtro, comentario).
    puedeRefrescar() {
      var cola = this.$('solCola'), vista = this.$('solVistaCambio'), panel = this.$('panel-solicitudes');
      return this.cableado && this.rol === 'ADM' && !!cola && !cola.hidden && !(vista && vista.hidden) && !(panel && panel.hidden) &&
        !this.detalle && !this.ocupado && !(window.RefrescoAuto && window.RefrescoAuto.editando(this.doc, panel));
    }
    // -> el estado HTTP de la lectura (RefrescoAuto se detiene con 401 / 403).
    refrescarFondo() {
      var self = this;
      return this.listar(true).then(function () { return self.ultimoEstado; });
    }

    // La volumetria de hoy de cada categoria del detalle (VolumetriaCliente
    // de admin/iniciativa-admin.js, SLOT 0, con el mismo pedir). Al llegar
    // solo se tocan sus dos celdas (volumetria y tickets), nunca el resto del
    // detalle (un comentario a medio escribir se queda). Si el detalle ya es
    // otro, no se pinta. -> Promise (para las pruebas).
    cargarVolumetrias(d) {
      var self = this, A = window.IniciativaAdmin, cats = d.categorias_detalle || [];
      if (!cats.length) return Promise.resolve(null);
      if (!A || !A.VolumetriaCliente) {
        cats.forEach(function (c, n) { self.pintarVolumetria(d, n, { estado: 'error', valor: null }); });
        return Promise.resolve(null);
      }
      if (!this.volumetria) this.volumetria = new A.VolumetriaCliente(this.pedir);
      return Promise.all(cats.map(function (c, n) {
        return self.volumetria.consultar(c.categoria).then(function (e) { self.pintarVolumetria(d, n, e); },
          function () { self.pintarVolumetria(d, n, { estado: 'error', valor: null }); });
      }));
    }

    pintarVolumetria(d, n, e) {
      if (this.detalle !== d) return;
      var c = (d.categorias_detalle || [])[n], v = { estado: e && e.estado, valor: e && e.valor };
      var vol = this.$('solVol-' + n), tk = this.$('solTk-' + n);
      if (vol) vol.innerHTML = volTexto(v);
      if (tk && c) tk.innerHTML = ticketsTexto(v, c.pct_nuevo);
    }

    verDetalle(id) {
      var self = this;
      return Promise.resolve().then(function () { return self.pedir(URL + '?accion=detalle&id=' + encodeURIComponent(id), { cache: 'no-store', credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          var caja = self.$('solDetalle');
          if (r.status !== 200) {
            self.mensaje('solMsg', 'error', h(r.json.error || ('No se pudo leer la solicitud (respuesta ' + r.status + ').')));
            return null;
          }
          self.detalle = r.json;
          caja.innerHTML = htmlDetalle(r.json, self.tipos(), {});
          caja.hidden = false;
          if (self.alVerSolicitud) self.alVerSolicitud(r.json);
          self.cargarVolumetrias(r.json);
          return r.json;
        }, function () {
          self.mensaje('solMsg', 'error', 'No se pudo contactar al servidor.');
          return null;
        });
    }

    cerrarDetalle() {
      this.detalle = null;
      this.$('solDetalle').hidden = true;
      this.$('solDetalle').innerHTML = '';
    }

    comentario() { var c = this.$('solComentario'); return c ? String(c.value || '').trim() : ''; }

    // POST; despues de la respuesta se releen la lista y el detalle (la
    // verdad es la del servidor: intentos, ultimo error, estado).
    enviar(accion, datos, exito) {
      var self = this, d = this.detalle;
      if (!d || this.ocupado) return Promise.resolve(null);
      this.ocupado = true;
      this.mensaje('solDetMsg', '', '<span>' + (accion === 'aplicar' ? 'Aplicando…' : 'Rechazando…') + '</span>');
      return Promise.resolve().then(function () { return self.pedir(URL + '?accion=' + accion, { method: 'POST', body: datos, credentials: 'same-origin' }); })
        .then(leer)
        .then(function (r) {
          self.ocupado = false;
          var j = r.json, ok = r.status === 200 && j[exito] === true;
          var html = ok ? (accion === 'aplicar' ? '<strong>Solicitud #' + h(d.id) + ' aplicada:</strong> la iniciativa ya tiene el cambio.'
                                                : '<strong>Solicitud #' + h(d.id) + ' rechazada.</strong> La iniciativa no cambió.')
            : j[exito] === null ? h(j.error || 'No se pudo confirmar.') + ' Revisa la solicitud antes de reintentar.'
            : '<strong>No se ' + (accion === 'aplicar' ? 'aplicó' : 'rechazó') + '.</strong> ' + h(j.error || ('Respuesta ' + r.status + '.')) +
              (Array.isArray(j.errores) && j.errores.length ? '<ul>' + j.errores.map(function (e) { return '<li>' + h(e.mensaje) + '</li>'; }).join('') + '</ul>' : '') +
              (accion === 'aplicar' && j.tipo !== 'ClasificacionInvalida' && j.tipo !== 'FaltaComentario' ? ' La solicitud sigue pendiente.' : '');
          if (ok && accion === 'aplicar' && self.alCambiarIniciativa) self.alCambiarIniciativa(d.folio);
          if (self.alRevisar) self.alRevisar();
          return Promise.all([self.listar(), self.verDetalle(d.id)]).then(function () {
            self.mensaje('solDetMsg', ok ? 'listo' : j[exito] === null ? 'aviso' : 'error', html);
            return r;
          });
        }, function () {
          self.ocupado = false;
          self.mensaje('solDetMsg', 'aviso', 'No se pudo contactar al servidor: no se sabe si se ' + (accion === 'aplicar' ? 'aplicó' : 'rechazó') + '. Actualiza la cola antes de reintentar.');
          return null;
        });
    }

    aplicar() {
      var d = this.detalle;
      if (!d) return Promise.resolve(null);
      var comentario = this.comentario();
      if (d.tipo === 'OTROS' && !comentario) {
        this.mensaje('solDetMsg', 'error', 'Escribe qué se corrigió para cerrarla.');
        return Promise.resolve(null);
      }
      var datos = new FormData();
      datos.append('id', String(d.id));
      if (comentario) datos.append('comentario', comentario);
      var self = this, faltan = [];
      (d.categorias_detalle || []).forEach(function (c, n) {
        if (c.accion !== 'AGREGAR' || (c.tipo_iniciativa && c.tipo_agrupado)) return;
        var ti = self.doc.querySelector('[data-clas-ti="' + n + '"]'), ta = self.doc.querySelector('[data-clas-ta="' + n + '"]');
        var vi = ti ? ti.value : '', va = ta ? ta.value : '';
        if (!vi || !va) { faltan.push(c.categoria); return; }
        datos.append('clas_categoria', c.categoria);
        datos.append('clas_tipo_iniciativa', vi);
        datos.append('clas_tipo_agrupado', va);
      });
      if (faltan.length) {
        this.mensaje('solDetMsg', 'error', 'Elige Tipo de iniciativa y Agrupación de: ' + h(faltan.join(', ')) + '.');
        return Promise.resolve(null);
      }
      return this.enviar('aplicar', datos, 'aplicada');
    }

    rechazar() {
      var d = this.detalle;
      if (!d) return Promise.resolve(null);
      var comentario = this.comentario();
      if (!comentario) {
        this.mensaje('solDetMsg', 'error', 'Escribe por qué se rechaza.');
        return Promise.resolve(null);
      }
      var datos = new FormData();
      datos.append('id', String(d.id));
      datos.append('comentario', comentario);
      return this.enviar('rechazar', datos, 'rechazada');
    }
  }

  return { ColaSolicitudes: ColaSolicitudes, htmlLista: htmlLista, htmlDetalle: htmlDetalle, resumen: resumen, URL: URL };
})();
