/* =========================================================================
   rca-correo.js — seccion "Correo RCA" de admin/admin.html

   Prueba AISLADA del envio de un RCA por correo. Todo lo que cuenta pasa en
   el servidor (handlers/admin_rca_correo.ashx, App_Code/RcaCorreoPrueba.cs):
     - solo ADM (aqui solo se muestra el 403 si llega);
     - la cuenta remitente y su autorizacion (OAuth con Microsoft) viven en
       el servidor; la pagina nunca ve contrasenas ni tokens;
     - el envio usa SIEMPRE los destinatarios GUARDADOS, no lo que este
       escrito en los campos;
     - la validacion del documento que cuenta es la del servidor (extension,
       tipo MIME, tamano y firma del archivo); la de aqui es cortesia.
   No crea iniciativas ni solicitudes y no guarda el documento.
   ========================================================================= */

(function () {
  'use strict';

  var URL_RCA = '../handlers/admin_rca_correo.ashx';

  /* ---- Reglas puras (las prueba tools/tests/RcaCorreoSmoke.js) ---------- */

  var CORREO = /^[^\s@<>"';,]+@[^\s@<>"';,]+\.[^\s@<>"';,]+$/;

  function extension(nombre) {
    var n = String(nombre || '');
    var corte = Math.max(n.lastIndexOf('\\'), n.lastIndexOf('/'));
    if (corte >= 0) { n = n.slice(corte + 1); }
    var p = n.lastIndexOf('.');
    if (p <= 0 || p === n.length - 1) { return null; }
    var ext = n.slice(p + 1).trim();
    return /^[A-Za-z0-9]{1,10}$/.test(ext) ? ext : null;
  }

  /* '' = valido; si no, el motivo. Misma regla que RcaAdjunto (salvo la
     firma del archivo, que solo se revisa en el servidor). */
  function motivoArchivo(archivo, cfg) {
    if (!archivo) { return 'Selecciona un documento.'; }
    if (!archivo.size) { return 'El documento esta vacio.'; }
    if (archivo.size > cfg.maxBytes) { return 'El documento pasa del maximo de ' + mb(cfg.maxBytes) + '.'; }
    var ext = extension(archivo.name);
    var permitidas = (cfg.extensiones || []).map(function (e) { return e.toLowerCase(); });
    if (!ext || permitidas.indexOf(ext.toLowerCase()) < 0) {
      return 'Tipo de documento no permitido. Permitidos: ' + permitidas.join(', ') + '.';
    }
    return '';
  }

  function nombreAdjunto(archivo, cfg) {
    var ext = archivo ? extension(archivo.name) : null;
    return ext ? (cfg.nombreAdjunto || 'Prueba_RCA') + '.' + ext : '—';
  }

  function asunto(titulo, cfg) {
    var t = String(titulo || '').trim();
    return t ? (cfg.prefijoAsunto || 'PRUEBA RCA - ') + t : '—';
  }

  function correoValido(v, obligatorio) {
    var s = String(v || '').trim();
    if (!s) { return obligatorio ? 'Es obligatorio.' : ''; }
    if (/[;,\s]/.test(s)) { return 'Solo una direccion de correo.'; }
    return s.length <= 254 && CORREO.test(s) ? '' : 'No es un correo valido.';
  }

  function mb(bytes) {
    return (Math.round(bytes / 1048576 * 10) / 10) + ' MB';
  }

  var Reglas = {
    extension: extension, motivoArchivo: motivoArchivo, nombreAdjunto: nombreAdjunto,
    asunto: asunto, correoValido: correoValido
  };
  if (typeof module !== 'undefined' && module.exports) { module.exports = Reglas; }
  if (typeof document === 'undefined') { return; }

  /* ---- Estado de la pagina ---------------------------------------------- */

  var cfg = null;              // lo ultimo que mando el GET
  var enviando = false;
  var conectando = false;
  var temporizador = null;     // sondeo de la conexion
  var confirmarDesconectar = false;

  function $(id) { return document.getElementById(id); }

  function fechaTexto(iso) {
    if (!iso) { return ''; }
    var m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
    return m ? m[3] + '/' + m[2] + '/' + m[1] + ' ' + m[4] + ':' + m[5] : iso;
  }

  /* fetch que siempre devuelve { status, datos } (el handler responde JSON
     tambien en sus errores). */
  function pedir(url, opciones) {
    return fetch(url, Object.assign({ credentials: 'same-origin' }, opciones || {}))
      .then(function (r) {
        return r.json()
          .catch(function () { return { ok: false, mensaje: 'Respuesta HTTP ' + r.status + ' sin JSON.' }; })
          .then(function (d) { return { status: r.status, datos: d || {} }; });
      });
  }

  function mensajeDe(d) {
    return (d && (d.mensaje || d.error)) || 'Error desconocido.';
  }

  function msg(id, texto, clase) {
    var el = $(id);
    el.textContent = texto || '';
    el.className = 'rca-msg' + (clase ? ' ' + clase : '');
    el.hidden = !texto;
  }

  /* ---- Carga ------------------------------------------------------------- */

  function cargar() {
    return pedir(URL_RCA, { method: 'GET' })
      .then(function (r) {
        if (r.status === 403) {
          $('rcaAviso').textContent = mensajeDe(r.datos);
          $('rcaAviso').className = 'rca-aviso fallo';
          $('rcaContenido').hidden = true;
          return;
        }
        if (r.status !== 200) { throw new Error(mensajeDe(r.datos)); }
        cfg = r.datos;
        $('rcaAviso').hidden = true;
        $('rcaContenido').hidden = false;
        pintarRemitente();
        pintarDestinatarios(true);
        pintarPrueba();
        if (cfg.conexionPendiente && !temporizador) { mostrarCodigo(cfg.conexionPendiente); sondear(cfg.conexionPendiente.intervalo); }
      })
      .catch(function (e) {
        $('rcaAviso').textContent = 'No se pudo cargar la configuracion del correo RCA: ' + (e && e.message ? e.message : e);
        $('rcaAviso').className = 'rca-aviso fallo';
        $('rcaAviso').hidden = false;
      });
  }

  /* ---- Remitente ---------------------------------------------------------- */

  function pintarRemitente() {
    var t = $('rcaRemitente');
    $('rcaRemCuenta').textContent = cfg.remitente || 'sin configurar';
    $('rcaRemConectada').textContent = cfg.conectada
      ? 'Sí' + (cfg.conectadoEl ? ' · ' + fechaTexto(cfg.conectadoEl) : '') + (cfg.conectadoPor ? ' · ' + cfg.conectadoPor : '')
      : 'No';
    var estado, listo = false;
    if (!cfg.configurado) { estado = '🟡 ' + (cfg.problemaConfig || 'Falta configurar el remitente en Web.config.'); }
    else if (conectando) { estado = 'Esperando el inicio de sesión en Microsoft…'; }
    else if (cfg.conectada) { estado = '🟢 Lista para enviar'; listo = true; }
    else { estado = '🟡 ' + (cfg.problemaCuenta || 'Conecta la cuenta remitente.'); }
    $('rcaRemEstado').textContent = estado;
    t.dataset.estado = conectando ? 'ejecutando' : (listo ? 'listo' : 'pendiente');

    $('rcaConectar').hidden = !cfg.configurado;
    $('rcaConectar').disabled = conectando || enviando;
    $('rcaConectar').textContent = cfg.conectada ? 'Volver a conectar' : 'Conectar cuenta remitente';
    $('rcaDesconectar').hidden = !cfg.conectada && !cfg.problemaCuenta;
    $('rcaDesconectar').disabled = conectando || enviando;
    $('rcaDesconectar').textContent = confirmarDesconectar ? '¿Desconectar? Pulsa de nuevo' : 'Desconectar';
    $('rcaCodigoCuenta').textContent = cfg.remitente || '';
  }

  function mostrarCodigo(p) {
    conectando = true;
    $('rcaCodigo').hidden = false;
    $('rcaCodigoValor').textContent = p.codigo;
    var url = /^https:\/\//.test(p.url || '') ? p.url : 'https://www.microsoft.com/link';
    $('rcaCodigoUrl').href = url;
    $('rcaCodigoUrl').textContent = url.replace(/^https:\/\//, '');
    $('rcaCodigoExpira').textContent = p.expira ? 'El código vence a las ' + fechaTexto(p.expira).slice(11) + '.' : '';
    pintarRemitente();
  }

  function terminarConexion(texto, clase) {
    conectando = false;
    if (temporizador) { clearTimeout(temporizador); temporizador = null; }
    $('rcaCodigo').hidden = true;
    msg('rcaRemMsg', texto, clase);
    return cargar();
  }

  function sondear(intervalo) {
    temporizador = setTimeout(function () {
      temporizador = null;
      pedir(URL_RCA + '?accion=conectar-estado', { method: 'POST' }).then(function (r) {
        var d = r.datos;
        if (!d.ok) { return terminarConexion(mensajeDe(d), 'fallo'); }
        if (d.estado === 'conectada') { return terminarConexion('Cuenta remitente conectada.', 'ok'); }
        if (d.estado === 'pendiente') { sondear((d.conexionPendiente && d.conexionPendiente.intervalo) || intervalo); return; }
        return terminarConexion('La conexion ya no esta en curso. Vuelve a conectar.', 'fallo');
      }).catch(function (e) {
        terminarConexion('No se pudo consultar la conexion: ' + (e && e.message ? e.message : e), 'fallo');
      });
    }, Math.max(3, Number(intervalo) || 5) * 1000);
  }

  function conectar() {
    if (conectando || enviando) { return; }
    confirmarDesconectar = false;
    msg('rcaRemMsg', '');
    $('rcaConectar').disabled = true;
    pedir(URL_RCA + '?accion=conectar', { method: 'POST' }).then(function (r) {
      if (!r.datos.ok) { $('rcaConectar').disabled = false; msg('rcaRemMsg', mensajeDe(r.datos), 'fallo'); return; }
      mostrarCodigo(r.datos.conexionPendiente);
      sondear(r.datos.conexionPendiente.intervalo);
    }).catch(function (e) {
      $('rcaConectar').disabled = false;
      msg('rcaRemMsg', 'No se pudo contactar con el servidor: ' + (e && e.message ? e.message : e), 'fallo');
    });
  }

  function desconectar() {
    if (conectando || enviando) { return; }
    if (!confirmarDesconectar) { confirmarDesconectar = true; pintarRemitente(); return; }
    confirmarDesconectar = false;
    $('rcaDesconectar').disabled = true;
    pedir(URL_RCA + '?accion=desconectar', { method: 'POST' }).then(function (r) {
      msg('rcaRemMsg', r.datos.ok ? 'Cuenta remitente desconectada.' : mensajeDe(r.datos), r.datos.ok ? 'ok' : 'fallo');
      return cargar();
    });
  }

  /* ---- Destinatarios ------------------------------------------------------ */

  function destinatariosSinGuardar() {
    var d = cfg.destinatarios || {};
    return $('rcaPara').value.trim() !== (d.para || '') || $('rcaCc').value.trim() !== (d.cc || '');
  }

  function pintarDestinatarios(rellenar) {
    var d = cfg.destinatarios || {};
    if (rellenar) { $('rcaPara').value = d.para || ''; $('rcaCc').value = d.cc || ''; }
    $('rcaDestModificado').textContent = d.modificadoEl
      ? 'Guardado el ' + fechaTexto(d.modificadoEl) + (d.modificadoPor ? ' por ' + d.modificadoPor : '') + '.'
      : (cfg.problemaDestinatarios || 'Sin destinatarios guardados.');
    $('rcaFormDest').dataset.estado = d.para && !destinatariosSinGuardar() ? 'listo' : 'pendiente';
    $('rcaGuardar').disabled = enviando;
  }

  function guardar(ev) {
    ev.preventDefault();
    if (enviando) { return; }
    var ep = correoValido($('rcaPara').value, true);
    var ec = correoValido($('rcaCc').value, false);
    $('rcaParaErr').textContent = ep;
    $('rcaCcErr').textContent = ec;
    if (ep || ec) { msg('rcaDestMsg', 'Revisa los correos.', 'fallo'); return; }

    var cuerpo = new URLSearchParams();
    cuerpo.append('para', $('rcaPara').value.trim());
    cuerpo.append('cc', $('rcaCc').value.trim());
    $('rcaGuardar').disabled = true;
    pedir(URL_RCA + '?accion=guardar', { method: 'POST', body: cuerpo }).then(function (r) {
      var d = r.datos;
      if (!d.ok) {
        var e = d.errores || {};
        $('rcaParaErr').textContent = e.para || '';
        $('rcaCcErr').textContent = e.cc || '';
        msg('rcaDestMsg', mensajeDe(d), 'fallo');
        return;
      }
      cfg.destinatarios = d.destinatarios;
      msg('rcaDestMsg', 'Destinatarios guardados.', 'ok');
      pintarDestinatarios(true);
      pintarPrueba();
    }).catch(function (e) {
      msg('rcaDestMsg', 'No se pudo contactar con el servidor: ' + (e && e.message ? e.message : e), 'fallo');
    }).then(function () { $('rcaGuardar').disabled = enviando; });
  }

  /* ---- Prueba --------------------------------------------------------------- */

  function archivoElegido() {
    var f = $('rcaArchivo').files;
    return f && f.length === 1 ? f[0] : null;
  }

  function motivoNoListo() {
    if (!cfg.configurado) { return 'Falta configurar el remitente en el servidor.'; }
    if (!cfg.conectada) { return 'Conecta la cuenta remitente.'; }
    if (!(cfg.destinatarios && cfg.destinatarios.para)) { return 'Guarda el Correo RCA.'; }
    if (destinatariosSinGuardar()) { return 'Hay cambios sin guardar en los destinatarios.'; }
    if (!$('rcaTitulo').value.trim()) { return 'Escribe el título de prueba.'; }
    if ($('rcaArchivo').files && $('rcaArchivo').files.length > 1) { return 'Solo se permite un documento.'; }
    return motivoArchivo(archivoElegido(), cfg);
  }

  function pintarPrueba() {
    if (!cfg) { return; }
    var archivo = archivoElegido();
    var d = cfg.destinatarios || {};
    $('rcaArchivo').accept = (cfg.extensiones || []).map(function (e) { return '.' + e; }).join(',');
    $('rcaArchivoNota').textContent = 'Un documento: ' + (cfg.extensiones || []).join(', ') +
      '. Máximo ' + mb(cfg.maxBytes) + '. Se envía como ' + (cfg.nombreAdjunto || 'Prueba_RCA') + '.<extensión>.';
    $('rcaResAsunto').textContent = asunto($('rcaTitulo').value, cfg);
    $('rcaResAdjunto').textContent = nombreAdjunto(archivo, cfg);
    $('rcaResPara').textContent = d.para || '—';
    $('rcaResCc').textContent = d.cc || 'sin copia';

    var motivo = motivoNoListo();
    $('rcaPruebaEstado').textContent = enviando ? 'Enviando…' : (motivo ? '🟡 ' + motivo : '🟢 Listo para probar');
    $('rcaFormPrueba').dataset.estado = enviando ? 'ejecutando' : (motivo ? 'pendiente' : 'listo');
    $('rcaEnviar').disabled = enviando || !!motivo;
    $('rcaEnviar').textContent = enviando ? 'Enviando…' : 'Probar correo RCA';
    $('rcaTitulo').disabled = enviando;
    $('rcaArchivo').disabled = enviando;
  }

  function resultado(ok, titulo, detalle) {
    var r = $('rcaResultado');
    r.hidden = false;
    r.className = 'job-ejecucion ' + (ok === null ? 'en-curso' : ok ? 'ok' : 'fallo');
    $('rcaResultadoTit').textContent = titulo;
    $('rcaResultadoDet').textContent = detalle || '';
  }

  function enviar(ev) {
    ev.preventDefault();
    if (enviando || motivoNoListo()) { return; }   // sin envios duplicados

    var datos = new FormData();
    datos.append('titulo', $('rcaTitulo').value.trim());
    datos.append('archivo', archivoElegido());

    enviando = true;
    resultado(null, 'Enviando el correo de prueba…', '');
    pintarPrueba(); pintarRemitente(); pintarDestinatarios(false);

    pedir(URL_RCA + '?accion=enviar', { method: 'POST', body: datos }).then(function (r) {
      var d = r.datos;
      if (d.ok) { resultado(true, 'Correcto — correo aceptado por Microsoft', d.mensaje); }
      else { resultado(false, 'Fallo — ' + (d.codigo || ('HTTP ' + r.status)), mensajeDe(d)); }
    }).catch(function (e) {
      resultado(false, 'Fallo — no se pudo contactar con el servidor',
        String(e && e.message ? e.message : e) + ' El correo pudo o no haberse enviado: revisa el buzón antes de reintentar.');
    }).then(function () {
      enviando = false;
      pintarPrueba(); pintarRemitente(); pintarDestinatarios(false);
    });
  }

  /* ---- Arranque ----------------------------------------------------------- */

  function iniciar() {
    if (!$('rca')) { return; }
    $('rcaConectar').addEventListener('click', conectar);
    $('rcaDesconectar').addEventListener('click', desconectar);
    $('rcaFormDest').addEventListener('submit', guardar);
    $('rcaFormDest').addEventListener('input', function () {
      if (!cfg) { return; }
      $('rcaParaErr').textContent = ''; $('rcaCcErr').textContent = '';
      msg('rcaDestMsg', '');
      pintarDestinatarios(false); pintarPrueba();
    });
    $('rcaFormPrueba').addEventListener('submit', enviar);
    $('rcaFormPrueba').addEventListener('input', function () { $('rcaResultado').hidden = true; pintarPrueba(); });
    $('rcaFormPrueba').addEventListener('change', function () { $('rcaResultado').hidden = true; pintarPrueba(); });
    cargar();
  }

  document.addEventListener('DOMContentLoaded', iniciar);
})();
