// tools/tests/RcaCorreoHeadlessSmoke.js - la seccion "Correo RCA" de
// admin/admin.html en un Chrome de verdad (tools/tests/BancoHeadless.js),
// con un fetch de mentira: no hay servidor .NET ni Microsoft detras.
//
//   ?          ADM, remitente conectado, destinatarios guardados:
//              boton deshabilitado sin titulo/archivo; con ambos, resumen
//              (asunto, adjunto renombrado, Para, CC) y boton habilitado;
//              dos clics seguidos = UN POST y el boton deshabilitado mientras
//              tanto; resultado correcto; archivo .exe y destinatarios sin
//              guardar deshabilitan el envio.
//   ?falla=1   el servidor responde un fallo: se muestra con su codigo y el
//              boton se rehabilita para reintentar.
//   ?rol=mod   GET 403: aviso y sin controles.
//
//   node tools\tests\RcaCorreoHeadlessSmoke.js
'use strict';
var Banco = require('./BancoHeadless');
if (!Banco.CHROME) { console.log('SKIP: sin Chrome/Edge'); process.exit(0); }

function falso() {
  var q = location.search;
  window.__envios = [];
  var cfg = {
    remitente: 'remitente.rca@outlook.com', configurado: true, conectada: true,
    conectadoPor: 'SORIANA\\adm', conectadoEl: '2026-11-03T09:00:00',
    destinatarios: { para: 'remitente.rca@outlook.com', cc: 'remitente.rca@outlook.com', modificadoPor: 'SORIANA\\adm', modificadoEl: '2026-11-03T09:05:00' },
    maxBytes: 3145728, extensiones: ['pdf', 'docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'],
    prefijoAsunto: 'PRUEBA RCA - ', nombreAdjunto: 'Prueba_RCA', maxTitulo: 150
  };
  function resp(status, obj, ms) {
    return new Promise(function (ok) {
      setTimeout(function () { ok(new Response(JSON.stringify(obj), { status: status, headers: { 'Content-Type': 'application/json' } })); }, ms || 0);
    });
  }
  window.fetch = function (url, op) {
    url = String(url);
    var metodo = (op && op.method) || 'GET';
    if (url.indexOf('admin_correos') >= 0) { return resp(200, { fechaCorte: '', servicios: [], flujos: {} }); }
    if (url.indexOf('admin_rca_correo') < 0) { return resp(404, {}); }
    if (metodo === 'GET') {
      if (/rol=mod/.test(q)) { return resp(403, { error: 'Solo un administrador (ADM) puede usar la prueba de correo RCA.', tipo: 'RolInsuficiente' }); }
      return resp(200, cfg);
    }
    if (url.indexOf('accion=enviar') >= 0) {
      var cuerpo = op.body;
      window.__envios.push({ titulo: cuerpo.get('titulo'), archivo: cuerpo.get('archivo') && cuerpo.get('archivo').name });
      if (/falla=1/.test(q)) { return resp(502, { ok: false, codigo: 'GraphRechazo', mensaje: 'Microsoft rechazo el mensaje (ErrorInvalidRecipients). No se envio.' }, 300); }
      return resp(200, { ok: true, codigo: 'Enviado', mensaje: 'Microsoft acepto el correo.' }, 300);
    }
    return resp(400, { ok: false, mensaje: 'no' });
  };
}

function sonda() {
  var r = [];
  function $(id) { return document.getElementById(id); }
  function fin() { var p = document.createElement('pre'); p.id = '__res'; p.textContent = JSON.stringify({ r: r }); document.body.appendChild(p); }
  function archivo(nombre, tipo, bytes) {
    var dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], nombre, { type: tipo }));
    $('rcaArchivo').files = dt.files;
    $('rcaArchivo').dispatchEvent(new Event('change', { bubbles: true }));
  }
  setTimeout(function () {
    if (/rol=mod/.test(location.search)) {
      r.push(['aviso403', $('rcaAviso').textContent]);
      r.push(['ocultos', $('rcaContenido').hidden && getComputedStyle($('rcaContenido')).display === 'none']);
      return fin();
    }
    r.push(['visible', !$('rcaContenido').hidden]);
    r.push(['codigoNoSeVe', getComputedStyle($('rcaCodigo')).display === 'none' && getComputedStyle($('rcaResultado')).display === 'none']);
    r.push(['remitente', $('rcaRemCuenta').textContent]);
    r.push(['paraCargado', $('rcaPara').value]);
    r.push(['inicialDeshabilitado', $('rcaEnviar').disabled]);
    r.push(['inicialMotivo', $('rcaPruebaEstado').textContent]);
    r.push(['tituloEsInput', $('rcaTitulo').tagName]);
    r.push(['accept', $('rcaArchivo').accept]);

    $('rcaTitulo').value = 'Caida WMS';
    $('rcaTitulo').dispatchEvent(new Event('input', { bubbles: true }));
    archivo('Informe final.PDF', 'application/pdf', [37, 80, 68, 70, 45]);
    r.push(['asunto', $('rcaResAsunto').textContent]);
    r.push(['adjunto', $('rcaResAdjunto').textContent]);
    r.push(['resPara', $('rcaResPara').textContent]);
    r.push(['resCc', $('rcaResCc').textContent]);
    r.push(['habilitado', !$('rcaEnviar').disabled]);

    $('rcaEnviar').click();
    $('rcaEnviar').click();
    r.push(['deshabilitadoEnviando', $('rcaEnviar').disabled]);
    r.push(['tituloBloqueado', $('rcaTitulo').disabled]);

    setTimeout(function () {
      r.push(['envios', window.__envios.length]);
      r.push(['enviado', window.__envios[0]]);
      r.push(['resultadoClase', $('rcaResultado').className]);
      r.push(['resultadoTit', $('rcaResultadoTit').textContent]);
      r.push(['rehabilitado', !$('rcaEnviar').disabled]);

      if (/falla=1/.test(location.search)) { return fin(); }

      archivo('virus.exe', 'application/octet-stream', [77, 90]);
      r.push(['exeDeshabilita', $('rcaEnviar').disabled]);
      r.push(['exeMotivo', $('rcaPruebaEstado').textContent]);

      archivo('rca.docx', '', [80, 75, 3, 4]);
      $('rcaPara').value = 'otro@outlook.com';
      $('rcaPara').dispatchEvent(new Event('input', { bubbles: true }));
      r.push(['sinGuardarDeshabilita', $('rcaEnviar').disabled]);
      r.push(['sinGuardarMotivo', $('rcaPruebaEstado').textContent]);
      fin();
    }, 1000);
  }, 300);
}

var antes = '<script>(' + falso.toString() + ')();</script>';
var html = Banco.pagina('admin/admin.html', 'admin.js', antes, sonda);
var URL_P = '/admin/__rca.html';
var paginas = {}; paginas[URL_P] = html;

Banco.correr(paginas, [URL_P, URL_P + '?falla=1', URL_P + '?rol=mod']).then(function (res) {
  var fallos = 0, pasados = 0;
  function check(caso, esperado, obtenido) {
    var ok = JSON.stringify(esperado) === JSON.stringify(obtenido);
    if (ok) { pasados++; } else { fallos++; }
    console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + JSON.stringify(esperado) + '  obtenido=' + JSON.stringify(obtenido)));
  }
  var a = Banco.mapa(res[0]), f = Banco.mapa(res[1]), m = Banco.mapa(res[2]);
  check('W1 la seccion se muestra a ADM', true, a.visible);
  check('W1b sin conexion en curso, el codigo y el resultado no se ven (hidden gana al CSS)', true, a.codigoNoSeVe);
  check('W2 remitente y Correo RCA guardado', ['remitente.rca@outlook.com', 'remitente.rca@outlook.com'], [a.remitente, a.paraCargado]);
  check('W3 sin titulo ni archivo: boton deshabilitado', true, a.inicialDeshabilitado);
  check('W3b el semaforo dice que falta el titulo', true, /título de prueba/.test(a.inicialMotivo || ''));
  check('W3c rcaTitulo es el campo, no otro elemento con el mismo id', 'INPUT', a.tituloEsInput);
  check('W4 accept con las extensiones del servidor', '.pdf,.docx,.xlsx,.pptx,.doc,.xls,.ppt', a.accept);
  check('W5 resumen: asunto', 'PRUEBA RCA - Caida WMS', a.asunto);
  check('W6 resumen: adjunto renombrado con la extension original', 'Prueba_RCA.PDF', a.adjunto);
  check('W7 resumen: Para y CC guardados', ['remitente.rca@outlook.com', 'remitente.rca@outlook.com'], [a.resPara, a.resCc]);
  check('W8 con titulo y archivo: habilitado', true, a.habilitado);
  check('W9 al pulsar: deshabilitado y campos bloqueados', [true, true], [a.deshabilitadoEnviando, a.tituloBloqueado]);
  check('W10 doble clic = un solo envio, con titulo y archivo', [1, { titulo: 'Caida WMS', archivo: 'Informe final.PDF' }], [a.envios, a.enviado]);
  check('W11 exito visible', ['job-ejecucion ok', 'Correcto — correo aceptado por Microsoft'], [a.resultadoClase, a.resultadoTit]);
  check('W12 tras el envio se puede volver a probar', true, a.rehabilitado);
  check('W13 .exe deshabilita con motivo', [true, true], [a.exeDeshabilita, /no permitido/.test(a.exeMotivo || '')]);
  check('W14 destinatarios sin guardar deshabilitan', [true, true], [a.sinGuardarDeshabilita, /sin guardar/.test(a.sinGuardarMotivo || '')]);
  check('W15 fallo visible con su codigo', ['job-ejecucion fallo', 'Fallo — GraphRechazo'], [f.resultadoClase, f.resultadoTit]);
  check('W16 tras un fallo se puede reintentar', [1, true], [f.envios, f.rehabilitado]);
  check('W17 MOD (403): aviso y sin controles (ni en pantalla)', ['Solo un administrador (ADM) puede usar la prueba de correo RCA.', true], [m.aviso403, m.ocultos]);
  console.log('\n' + pasados + ' pasaron, ' + fallos + ' fallaron');
  process.exit(fallos ? 1 : 0);
});
