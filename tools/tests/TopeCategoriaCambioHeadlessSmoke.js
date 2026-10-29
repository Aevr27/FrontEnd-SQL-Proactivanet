// tools/tests/TopeCategoriaCambioHeadlessSmoke.js - "Solicitar cambios" >
// Categorias: el TOPE DE 100% POR CATEGORIA del % pedido, en un Chrome de
// verdad (tools/tests/BancoHeadless.js; no escribe en disco) con la pagina
// REAL admin/iniciativas.html y un fetch de mentira (sesion, registro y
// volumetria).
//
// La regla es la de ValidadorGestionAdmin.Modificar + Excede
// (App_Code/GestionIniciativaAdmin.cs), la que corre al aplicar; aqui se
// aplica al registro cargado (RegistroIniciativas.excedeTope):
//
//   T1-T3   el caso de la VM: otras activas 34% + 11.12% = 45.12%; cabe hasta
//           54.88%; 54.89% y 100% no, con el maximo en el mensaje.
//   T4      el % actual de la PROPIA iniciativa no cuenta: el pedido lo
//           reemplaza (20% propio + 45.12% + 54.88% sigue cabiendo).
//   T5      ruta ya excedida (historico): una ligada que consume puede bajar o
//           dejar igual su %, nunca subirlo; el maximo es su % actual.
//   T6-T7   no se revisa lo que no consume: agrupacion fuera de agrupadores,
//           Estado final no vivo.
//   T8      categoria por agregar: agrupacion del prefijo (PRB -> Problem),
//           mismo tope.
//   T9      reactivada (Estado final vivo, el actual no): el % actual de sus
//           ligadas tambien cuenta.
//   U1-U3   al escribir el %: aviso junto a la casilla, aria-invalid y
//           aria-describedby; se quita al corregir.
//   K1-K2   en tickets: los tickets que dan mas del maximo avisan igual (con
//           cuantos tickets da el maximo); los que caben, no.
//   G1-G2   "Agregar cambio a la solicitud" no agrega lo que excede; si lo que
//           cabe.
//   E1-E3   al enviar (validarEnvio): un cambio que excede bloquea el envio y
//           no se llama al servidor; un Estado pedido en la misma solicitud
//           que reactiva la iniciativa tambien se revisa.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\TopeCategoriaCambioHeadlessSmoke.js   # sale 0 si todo paso
//
// Sin Chrome instalado dice SKIP y sale 0. Otra ruta: CHROME=<ruta>.
'use strict';
var Banco = require('./BancoHeadless');

var fallos = 0;
function Check(caso, esperado, obtenido) {
  var e = JSON.stringify(esperado), o = JSON.stringify(obtenido);
  var ok = e === o;
  if (!ok) fallos++;
  console.log((ok ? 'PASS  ' : 'FAIL  ') + caso + (ok ? '' : '  esperado=' + e + '  obtenido=' + o));
}
if (!Banco.CHROME) { console.log('SKIP  sin Chrome/Edge (CHROME=<ruta> para indicar otro)'); process.exit(0); }

var RUTA_A = '/Servicios/Correo/Buzones';
var RUTA_H = '/Servicios/Correo/Historica';
var RUTA_R = '/Servicios/Correo/ReqOpr';
var RUTA_N = '/Servicios/Correo/Nueva';

function ini(folio, estado, activa, cats) {
  return {
    folio: folio, titulo: 'Titulo ' + folio, titulo_problem: 'Titulo ' + folio, agrup: 'Problem', estado: estado,
    tickets_reduce: 0, vol_reduce_folio: 0, riesgo_folio: 0, retrazado: 0, sem_fecha: 'ambar', fecha_retrasada: false,
    f_analisis: '2026-12-01', f_solucion: null, f_cierre: null, n_analisis: 0, n_solucion: 0, n_cierre: 0, antiguedad: 10,
    po: 'PO 01', so: 'SO 01', director: 'Dir A', manager: null, descripcion: 'Desc', observaciones: null,
    activa: activa, seguimiento: activa, sin_categoria: !cats.length, prefijo: 'PRB', f_creacion: '2026-01-10',
    po_capturado: 'PO 01', so_capturado: 'SO 01',
    categorias: cats.map(function (c) {
      return { categoria: c[0], pct_dism: c[1], agrup: c[2] || 'Problem', tickets_reduce: 0, po: 'PO 01', so: 'SO 01', director: 'Dir A', n2: null };
    })
  };
}

var REGISTRO = {
  estados_activos: ['En Análisis', 'En Solución', 'En Monitoreo'], agrupadores: ['Problem', 'SorIA', 'Adopcion', 'Mejora'], fecha_gen: '01/10/2026',
  tipos_iniciativa: [{ prefijo: 'PRB', nombre: 'Problem' }],
  estados_problem: ['En Análisis', 'En Solución', 'En Monitoreo', 'Detenido', 'Cerrado'],
  persistencia_solicitudes: true, solicitudes_varios: true,
  iniciativas: [
    // La que pide: 20% propio en A; 30% en H (ruta ya excedida); ReqOpr en R.
    ini('PRB 2026-000010', 'En Análisis', true, [[RUTA_A, 0.2], [RUTA_H, 0.3], [RUTA_R, 0.1, 'ReqOpr']]),
    ini('PRB 2026-000011', 'En Solución', true, [[RUTA_A, 0.34], [RUTA_H, 0.9], [RUTA_R, 0.95]]),
    ini('PRB 2026-000012', 'En Monitoreo', true, [[RUTA_A, 0.1112], [RUTA_N, 0.6]]),
    ini('PRB 2026-000013', 'Cerrado', false, [[RUTA_A, 0.5]]),                  // cerrada: no cuenta
    // Detenida (no consume hoy) con 60% en A.
    ini('PRB 2026-000014', 'Detenido', false, [[RUTA_A, 0.6]])
  ]
};

var ANTES = '<script>\n' +
  'window.__envios = 0;\n' +
  'window.fetch = function (u, op) { u = String(u && u.url || u); var j = {};\n' +
  '  if (/admin_sesion\\.ashx/.test(u)) j = { autorizado: true, rol: "ADM", solicitante: true };\n' +
  '  else if (/admin_iniciativas_registro/.test(u)) j = ' + JSON.stringify(REGISTRO) + ';\n' +
  '  else if (/admin_iniciativas_volumetria/.test(u)) j = { rutas: [{ estado: "ok", volumetria: 1000 }] };\n' +
  '  else if (/admin_iniciativas_solicitudes/.test(u)) { window.__envios++; j = { enviada: true, id_solicitud: 1 }; }\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: true, status: 200,\n' +
  '    json: function () { return Promise.resolve(j); }, text: function () { return Promise.resolve(JSON.stringify(j)); } }); }, 10); }); };\n' +
  'Element.prototype.scrollIntoView = function () {};\n' +
  '</script>\n';

function sonda() {
  var R = [];
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function apunta(caso, v) { R.push([caso, v]); }
  function $(id) { return document.getElementById(id); }
  function clic(el) { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); }
  function escribe(el, v) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); }
  (async function () {
    try {
      await espera(2500);
      var M = window.RegistroIniciativas, pag = window.IniciativasPagina.registro, reg = pag.registro;
      var cap = { iniciativas: reg.iniciativas, agrupadores: reg.agrupadores, estadosActivos: reg.estadosActivos };
      var yo = reg.buscar('PRB 2026-000010'), det = reg.buscar('PRB 2026-000014');
      var A = yo.categorias[0].categoria, H = yo.categorias[1].categoria, Rr = yo.categorias[2].categoria;
      function x(i, ruta, pct, nueva, estado) { return M.excedeTope(cap, i, ruta, pct, nueva, estado === undefined ? i.estado : estado); }
      apunta('T', {
        cabe: x(yo, A, '54.88', false), pasa: x(yo, A, '54.89', false), cien: x(yo, A, '100', false),
        histBaja: x(yo, H, '25', false), histIgual: x(yo, H, '30', false), histSube: x(yo, H, '31', false),
        reqopr: x(yo, Rr, '100', false), cerrada: x(yo, A, '100', false, 'Cerrado'),
        nuevaCabe: x(yo, '/Servicios/Correo/Nueva', '40', true), nuevaPasa: x(yo, '/Servicios/Correo/Nueva', '40.01', true),
        react: M.reactivadasExceden(cap, det, 'En Análisis', []), reactPedida: M.reactivadasExceden(cap, det, 'En Análisis', [det.categorias[0].categoria]),
        sigueDet: M.reactivadasExceden(cap, det, 'Detenido', [])
      });

      // ---- UI: escribir el % ----
      pag.abrirDetalle('PRB 2026-000010');
      await espera(100);
      clic($('regCambioBoton'));
      var campo = $('regCambioCampo');
      campo.value = 'pct';
      campo.dispatchEvent(new Event('change', { bubbles: true }));
      await espera(50);
      var casilla = document.querySelector('[data-cambio-pct="0"]'), aviso = $('regCambioTope-l0');
      apunta('u0', [aviso.hidden, casilla.getAttribute('aria-describedby'), casilla.getAttribute('aria-invalid')]);
      escribe(casilla, '100');
      apunta('u1', [aviso.hidden, aviso.textContent, casilla.getAttribute('aria-invalid'), aviso.getAttribute('aria-live')]);
      escribe(casilla, '54.88');
      apunta('u2', [aviso.hidden, aviso.textContent, casilla.getAttribute('aria-invalid')]);

      // ---- Tickets ----
      var modo = document.querySelector('[data-cambio-modo="l0"]');
      modo.value = 'tickets';
      modo.dispatchEvent(new Event('change', { bubbles: true }));
      await espera(200);
      var tk = document.querySelector('[data-cambio-tickets="l0"]');
      escribe(tk, '600');
      var avTk = $('regCambioTope-l0');
      apunta('k1', [avTk.hidden, avTk.textContent, tk.getAttribute('aria-invalid'), tk.getAttribute('aria-describedby')]);
      escribe(tk, '548');
      apunta('k2', [avTk.hidden, tk.getAttribute('aria-invalid'), pag.cambio.pctPedido(A)]);

      // ---- Agregar a la lista ----
      escribe(tk, '600');
      clic(document.querySelector('[data-accion="cambio-agregar"]'));
      await espera(30);
      apunta('g1', [pag.lista.items.length, $('regCambioMsg').textContent.indexOf('el máximo permitido es 54.88%') >= 0]);
      escribe(document.querySelector('[data-cambio-tickets="l0"]'), '548');
      clic(document.querySelector('[data-accion="cambio-agregar"]'));
      await espera(30);
      apunta('g2', [pag.lista.items.length, pag.lista.items[0] && pag.lista.items[0].pcts[A]]);

      // ---- Envio: un cambio guardado que excede (p. ej. de antes) ----
      pag.lista.items[0].pcts[A] = '60';
      pag.lista.items[0].metas = {};
      $('regCambioMotivo').value = 'Ajuste de meta';
      $('regCambioMotivo').dispatchEvent(new Event('input', { bubbles: true }));
      clic($('regCambioEnviar'));
      await espera(50);
      apunta('e1', [$('regCambioMsg').textContent.indexOf('pides 60%, pero el máximo permitido es 54.88%') >= 0,
                    !!document.querySelector('[data-accion="cambio-confirmar"]'), window.__envios]);
      pag.lista.items[0].pcts[A] = '54.88';
      clic($('regCambioEnviar'));
      await espera(50);
      apunta('e2', [!!document.querySelector('[data-accion="cambio-confirmar"]'), window.__envios]);

      // ---- Envio: Estado que reactiva (lista armada a mano) ----
      var L = new M.ListaSolicitudCambio(det, pag.opcionesEstado());
      L.items.push({ campo: 'estado', propuesto: 'En Análisis', pcts: {}, nuevas: [], datos: {}, explicacion: '', metas: {}, vols: {} });
      L.motivo = 'Se reanuda';
      apunta('e3', L.validarEnvio().map(function (e) { return e.tope === true ? e.mensaje : null; }).filter(Boolean));
    } catch (e) { apunta('error', String(e && e.stack || e)); }
    var pre = document.createElement('pre'); pre.id = '__res';
    pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  })();
}

var paginas = { '/admin/__tope.html': Banco.pagina('admin/iniciativas.html', '../assets/js/sesion-admin.js', ANTES, sonda) };

Banco.correr(paginas, ['/admin/__tope.html']).then(function (res) {
  var A = Banco.mapa(res[0]);
  if (A.error) console.log('ERROR en la sonda: ' + A.error);
  var t = A.T || {};
  Check('T1 54.88% cabe (100% - 34% - 11.12%)', null, t.cabe);
  Check('T2 54.89% no: maximo 54.88%, usado 45.12% (cerrada fuera)', { pedido: 5489, disponible: 5488, usado: 4512, maximo: 5488 }, t.pasa);
  Check('T3 100% no', { pedido: 10000, disponible: 5488, usado: 4512, maximo: 5488 }, t.cien);
  Check('T4 el 20% propio no se suma: usado = solo otras (4512), el pedido reemplaza', [4512, null], [t.pasa && t.pasa.usado, t.cabe]);
  Check('T5 ruta excedida: bajar (25) y dejar igual (30) si; subir (31) no, maximo = su 30%',
    [null, null, { pedido: 3100, disponible: 1000, usado: 9000, maximo: 3000 }], [t.histBaja, t.histIgual, t.histSube]);
  Check('T6 fila ReqOpr (no consume): sin tope', null, t.reqopr);
  Check('T7 Estado final no vivo: sin tope', null, t.cerrada);
  Check('T8 por agregar (PRB -> Problem): 40% cabe, 40.01% no', [null, { pedido: 4001, disponible: 4000, usado: 6000, maximo: 4000 }],
    [t.nuevaCabe, t.nuevaPasa]);
  Check('T9 reactivada (000014): su 60% actual en A pasa de 34.88% (aqui la 000010 tambien es otra: 65.12%); pedido aparte o sin reactivar no',
    [[{ ruta: '/Servicios/Correo/Buzones', x: { pedido: 6000, disponible: 3488, usado: 6512, maximo: 3488 } }], [], []],
    [t.react, t.reactPedida, t.sigueDet]);
  Check('U1 sin escribir: sin aviso; la casilla lo describe', [true, 'regCambioTope-l0', 'false'], A.u0);
  Check('U2 100%: aviso en espanol con el maximo, aria-invalid, aria-live',
    [false, '/Servicios/Correo/Buzones: pides 100%, pero el máximo permitido es 54.88%. Otras iniciativas activas ya comprometen 45.12% y el tope por categoría es 100%.',
     'true', 'polite'], A.u1);
  Check('U3 54.88%: el aviso se quita', [true, '', 'false'], A.u2);
  Check('K1 600 tickets de 1000 (60%): aviso con el maximo en tickets',
    [false, '/Servicios/Correo/Buzones: esos tickets equivalen a 60%, pero el máximo permitido es 54.88% (548 tickets con la volumetría de hoy). ' +
      'Otras iniciativas activas ya comprometen 45.12% y el tope por categoría es 100%.', 'true', 'regCambioMeta-l0 regCambioTope-l0'], A.k1);
  Check('K2 548 tickets (54.8%): cabe', [true, 'false', '54.8'], A.k2);
  Check('G1 agregar con 600 tickets: no entra a la lista y dice el maximo', [0, true], A.g1);
  Check('G2 agregar con 548 tickets: entra', [1, '54.8'], A.g2);
  Check('E1 enviar con un cambio que excede: error, sin confirmar ni llamar al servidor', [true, false, 0], A.e1);
  Check('E2 corregido: pasa a la confirmacion (aun sin enviar)', [true, 0], A.e2);
  Check('E3 Estado que reactiva: el 60% actual de la categoria cuenta al enviar',
    ['Estado: /Servicios/Correo/Buzones: al pasar a «En Análisis» la iniciativa vuelve a comprometer su 60%, pero el máximo permitido es 34.88%. ' +
     'Otras iniciativas activas ya comprometen 65.12% y el tope por categoría es 100%.'], A.e3);
  console.log(fallos ? fallos + ' FALLO(S)' : 'TODO PASO');
  process.exit(fallos ? 1 : 0);
});
