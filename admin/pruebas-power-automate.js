/* =========================================================================
   pruebas-power-automate.js — PRUEBAS DE POWER AUTOMATE (SOLO LOCALHOST)

   Tres botones que mandan los eventos de prueba por el servidor
   (handlers/admin_pruebas_power_automate.ashx, App_Code/PruebasPowerAutomate.cs).
   El panel NO viene en el HTML: solo se construye si el servidor contesta
   200 a accion=estado, y eso solo pasa en localhost de desarrollo. Fuera de
   ahi el servidor responde 404 y aqui no se pinta nada. Ocultarlo es solo
   comodidad: la puerta real es la del servidor. La pagina nunca ve el URL
   del webhook.
   ========================================================================= */

(function () {
  'use strict';

  var URL_PA = '../handlers/admin_pruebas_power_automate.ashx';

  var BOTONES = [
    { evento: 'NEW_REQUEST',      texto: 'Probar nueva solicitud', detalle: 'TEST-PA-001 · ENVIADA · chat grupal de revisores' },
    { evento: 'REQUEST_APPROVED', texto: 'Probar aprobación',      detalle: 'TEST-PA-002 · APROBADA · código TEST-2026-000001 · mensaje privado' },
    { evento: 'REQUEST_REJECTED', texto: 'Probar rechazo',         detalle: 'TEST-PA-003 · RECHAZADA · comentario de prueba · mensaje privado' }
  ];

  var MENSAJES = {
    SoloLocalhost: 'El panel de pruebas solo está disponible en localhost.',
    SinWebhook: 'Falta configurar el webhook (TeamsWebhookUrl en el Web.config local).',
    SinDestinatario: 'No se pudo resolver el correo del destinatario de pruebas (TeamsPruebaDestinatario, CatPersona o UsuariosAdmin).',
    ConfiguracionInvalida: 'La configuración del webhook no es válida (URL https o TeamsWebhookFormato).',
    EnvioEnCurso: 'Ya hay un envío en curso; espera a que termine.',
    OrigenNoPermitido: 'La petición no salió de esta página; recárgala e inténtalo de nuevo.',
    EventoDesconocido: 'Evento desconocido.'
  };

  function el(tag, attrs, texto) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { n.setAttribute(k, attrs[k]); });
    if (texto != null) { n.textContent = texto; }
    return n;
  }

  function construir(estado, montaje) {
    var seccion = el('section', { 'class': 'admin-seccion', id: 'pruebasPa', 'aria-labelledby': 'pruebasPaTitulo' });
    var cab = el('div', { 'class': 'admin-seccion-cab' });
    cab.appendChild(el('h2', { id: 'pruebasPaTitulo' }, 'PRUEBAS DE POWER AUTOMATE (SOLO LOCALHOST)'));
    cab.appendChild(el('span', { 'class': 'admin-seccion-hint' }, 'datos sintéticos · no toca solicitudes'));
    seccion.appendChild(cab);

    var tarjeta = el('article', { 'class': 'job', 'data-estado': estado.webhook_configurado ? 'listo' : 'pendiente' });
    var d = estado.destinatario;
    var datos = el('dl', { 'class': 'job-datos' });
    [['Webhook', estado.webhook_configurado ? 'Configurado' : 'Sin configurar'],
     ['Formato', estado.formato || 'no válido'],
     ['Destinatario', d ? d.correo + ' · ' + d.fuente : 'Sin resolver'],
     ['Nombre en el aviso', estado.nombre_prueba || '—']
    ].forEach(function (par) { datos.appendChild(el('dt', null, par[0])); datos.appendChild(el('dd', null, par[1])); });
    tarjeta.appendChild(datos);

    var salida = el('p', { 'class': 'job-nota', role: 'status', 'aria-live': 'polite' }, '');
    var fila = el('div', { 'class': 'rca-botones' });
    var botones = BOTONES.map(function (b) {
      var boton = el('button', { type: 'button', 'class': 'btn chico', 'data-evento': b.evento, title: b.detalle }, b.texto);
      fila.appendChild(boton);
      return boton;
    });
    tarjeta.appendChild(fila);
    tarjeta.appendChild(salida);
    seccion.appendChild(tarjeta);
    montaje.appendChild(seccion);

    fila.addEventListener('click', function (ev) {
      var boton = ev.target.closest('button[data-evento]');
      if (!boton || boton.disabled) { return; }
      enviar(boton.getAttribute('data-evento'), botones, salida, tarjeta);
    });
  }

  function enviar(evento, botones, salida, tarjeta) {
    botones.forEach(function (b) { b.disabled = true; });
    tarjeta.setAttribute('data-estado', 'ejecutando');
    salida.className = 'job-nota';
    salida.textContent = 'Enviando ' + evento + '…';
    var cuerpo = new URLSearchParams();
    cuerpo.set('evento', evento);
    fetch(URL_PA + '?accion=enviar', {
      method: 'POST', credentials: 'same-origin', body: cuerpo
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, status: r.status, j: j }; }); })
      .then(function (res) {
        if (res.ok && res.j.enviado) {
          tarjeta.setAttribute('data-estado', 'listo');
          salida.textContent = 'Notificación enviada correctamente: ' + evento + ' (' + res.j.numero + ', HTTP ' + res.j.http + '). Revisa Teams.';
          return;
        }
        tarjeta.setAttribute('data-estado', 'pendiente');
        salida.className = 'job-nota job-nota-fallo';
        var base = MENSAJES[res.j.tipo] || 'No se pudo enviar la notificación.';
        var extra = res.j.http ? ' (HTTP ' + res.j.http + ')' : res.j.red ? ' (' + res.j.red + ')' : (!res.j.tipo ? ' (respuesta ' + res.status + ')' : '');
        salida.textContent = base + extra;
      })
      .catch(function () {
        tarjeta.setAttribute('data-estado', 'pendiente');
        salida.className = 'job-nota job-nota-fallo';
        salida.textContent = 'No se pudo contactar al servidor: no se sabe si se envió.';
      })
      .then(function () { botones.forEach(function (b) { b.disabled = false; }); });
  }

  function iniciar() {
    var montaje = document.getElementById('pruebasPaMontaje');
    if (!montaje) { return; }
    fetch(URL_PA + '?accion=estado', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (estado) { if (estado && estado.disponible === true) { construir(estado, montaje); } })
      .catch(function () { /* sin panel */ });
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', iniciar); }
  else { iniciar(); }
})();
