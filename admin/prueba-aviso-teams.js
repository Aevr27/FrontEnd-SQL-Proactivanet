/* =========================================================================
   prueba-aviso-teams.js — PRUEBA MANUAL de un aviso de Teams (solo ADM)

   Manda los seis campos a handlers/admin_prueba_aviso_teams.ashx, que envía
   por el mismo AvisoTeams de los flujos reales. La puerta es la del
   servidor; la página nunca ve el URL del webhook. Al cargar solo se lee el
   estado (GET): nada se envía hasta pulsar el botón.
   ========================================================================= */

(function () {
  'use strict';

  var URL_HANDLER = '../handlers/admin_prueba_aviso_teams.ashx';

  var DATO = {
    NEW_REQUEST:      { etiqueta: 'dato: fecha de la solicitud (aaaa-mm-dd)', nota: 'Posición [5] de NEW_REQUEST.' },
    REQUEST_APPROVED: { etiqueta: 'dato: código de la iniciativa', nota: 'Posición [5] de REQUEST_APPROVED.' },
    REQUEST_REJECTED: { etiqueta: 'dato: comentario del revisor', nota: 'Posición [5] de REQUEST_REJECTED.' }
  };

  var MENSAJES = {
    Aceptado: 'El endpoint aceptó la petición',
    SinWebhook: 'No se envió: TeamsWebhookUrl está vacío o ausente en el servidor.',
    ConfiguracionInvalida: 'No se envió: TeamsWebhookUrl no es un URL https absoluto o TeamsWebhookFormato no es válido.',
    HttpNoExitoso: 'El endpoint respondió con un código que no es de éxito',
    TiempoAgotado: 'Tiempo agotado: el endpoint no respondió dentro del límite.',
    FalloRed: 'Fallo de red al contactar el endpoint',
    FalloInterno: 'Falló el envío antes de obtener respuesta (armado del cuerpo u otro error). Ver la traza AvisoTeams.',
    EventoDesconocido: 'Aviso no armado: evento desconocido.',
    TipoDesconocido: 'Aviso no armado: tipo desconocido.',
    CorreoInvalido: 'Aviso no armado: el correo no tiene forma de correo.',
    CampoDemasiadoLargo: 'Aviso no armado: algún campo excede su largo máximo.',
    AvisoInvalido: 'Aviso no armado',
    TextoNoPermitido: 'Aviso no armado: el servidor rechazó el texto (marcado HTML).',
    EnvioEnCurso: 'Ya hay un envío en curso; espera a que termine.',
    RolInsuficiente: 'Solo un administrador (ADM) puede usar esta prueba.',
    AccesoDenegado: 'No tienes acceso a esta prueba.',
    OrigenNoPermitido: 'La petición no salió de esta página; recárgala e inténtalo de nuevo.'
  };

  function $(id) { return document.getElementById(id); }

  function hoy() {
    var d = new Date();
    function dos(n) { return (n < 10 ? '0' : '') + n; }
    return d.getFullYear() + '-' + dos(d.getMonth() + 1) + '-' + dos(d.getDate());
  }

  function ajustarDato() {
    var e = $('paEvento').value;
    $('paDatoEtiqueta').textContent = DATO[e].etiqueta;
    $('paDatoNota').textContent = DATO[e].nota;
    if (e === 'NEW_REQUEST' && !$('paDato').value) { $('paDato').value = hoy(); }
  }

  function leerJson(r) {
    return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; });
  }

  function pintarEstado(j) {
    var formato = j.formato
      ? j.formato + (j.formato_explicito ? ' (TeamsWebhookFormato configurado)' : ' (TeamsWebhookFormato ausente: valor por omisión)')
      : 'no válido (TeamsWebhookFormato no reconocido: no se enviaría)';
    $('paEstado').textContent = 'Webhook: ' + (j.webhook_configurado ? 'configurado' : 'sin configurar') + ' · Formato: ' + formato;
  }

  function mostrar(res) {
    var j = res.j || {};
    var salida = $('paSalida');
    salida.textContent = '';
    var linea = document.createElement('p');
    var base = MENSAJES[j.clase] || j.error || ('Respuesta inesperada del servidor (' + res.status + ').');
    if (j.clase === 'AvisoInvalido' && j.error) { base = base + ': ' + j.error; }
    if (j.http != null) { base += ' (HTTP ' + j.http + ')'; }
    else if (j.red) { base += ' (' + j.red + ')'; }
    if (j.clase === 'Aceptado') {
      base += '. Esto confirma que el endpoint recibió la petición, no que Power Automate haya ejecutado' +
              ' todas sus acciones ni que el mensaje haya llegado a Teams.';
    }
    linea.textContent = base;
    salida.className = 'pa-salida ' + (j.clase === 'Aceptado' ? 'ok' : 'fallo');
    salida.appendChild(linea);
    if (j.contenido) {
      var pre = document.createElement('pre');
      pre.className = 'pa-contenido';
      pre.textContent = 'Formato ' + j.formato + ' · contenido armado por AvisoTeams:\n' + j.contenido;
      salida.appendChild(pre);
    }
    $('paForm').setAttribute('data-estado', j.clase === 'Aceptado' ? 'listo' : 'pendiente');
  }

  function enviar(ev) {
    ev.preventDefault();
    var boton = $('paEnviar');
    if (boton.disabled) { return; }
    boton.disabled = true;
    $('paForm').setAttribute('data-estado', 'ejecutando');
    $('paSalida').className = 'pa-salida';
    $('paSalida').textContent = 'Enviando notificación de prueba…';
    var cuerpo = new URLSearchParams();
    ['evento', 'tipo', 'correo', 'nombre', 'numero', 'dato'].forEach(function (k) {
      cuerpo.set(k, $('paForm').elements[k].value);
    });
    fetch(URL_HANDLER + '?accion=enviar', { method: 'POST', credentials: 'same-origin', body: cuerpo })
      .then(leerJson)
      .then(mostrar)
      .catch(function () {
        $('paSalida').className = 'pa-salida fallo';
        $('paSalida').textContent = 'No se pudo contactar al servidor: no se sabe si se envió.';
      })
      .then(function () { boton.disabled = false; });
  }

  function iniciar() {
    fetch(URL_HANDLER, { credentials: 'same-origin' })
      .then(leerJson)
      .then(function (res) {
        if (!res.ok) {
          $('paEstado').className = 'rca-aviso fallo';
          $('paEstado').textContent = MENSAJES[res.j.tipo] || res.j.error || ('No disponible (' + res.status + ').');
          return;
        }
        pintarEstado(res.j);
        $('paForm').hidden = false;
        $('paEvento').addEventListener('change', ajustarDato);
        $('paForm').addEventListener('submit', enviar);
        ajustarDato();
      })
      .catch(function () {
        $('paEstado').className = 'rca-aviso fallo';
        $('paEstado').textContent = 'No se pudo contactar al servidor.';
      });
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', iniciar); }
  else { iniciar(); }
})();
