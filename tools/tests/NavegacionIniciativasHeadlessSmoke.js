// tools/tests/NavegacionIniciativasHeadlessSmoke.js - la navegacion de
// Iniciativas (dashboard.html y admin/iniciativas.html) en un Chrome de
// verdad (tools/tests/BancoHeadless.js; no escribe en disco), con las
// paginas REALES y un fetch de mentira que hace de admin_sesion.ashx y de
// los handlers de Admin.
//
// Es UX: aqui no se prueba quien PUEDE (eso es del servidor:
// AccesoIniciativasHttpSmoke.cs y AccesoAdminHttpSmoke.cs, con sus fuentes
// falsas), sino que la pagina ensena lo que admin_sesion dijo:
//
//   D1-D7  tablero: ADM/MOD ven la entrada Iniciativas de ADM/MOD; el PO/SO
//          sin rol, la del solicitante; las dos dicen "Iniciativas" (title
//          plegada, texto al desplegar) y nunca se ven juntas; sin nada,
//          ninguna; sin poder confirmar (rol que falla), Reintentar y
//          ninguna de las dos; Reintentar vuelve a preguntar.
//   A1-A6  admin/iniciativas.html: el PO/SO sin rol conserva su entrada
//          Iniciativas (activa), sin pestañas, y ve el aviso de PO/SO;
//          ADM/MOD la suya; sin nada, "sin acceso"; incierto: Reintentar, y
//          al confirmarse ADM la pagina vuelve.
//   P1-P3  pagina YA abierta: un ADM que es PO/SO sale de UsuariosAdmin; el
//          siguiente 403 de Admin vuelve a preguntar y la pagina pasa a solo
//          Nueva solicitud con lo escrito intacto, sin recargar.
//   S1-S7  Solicitudes sigue la regla de "Solicitar una iniciativa"
//          (solicitante): ADM ve la cola; MOD que no es PO/SO no ve ni
//          Solicitar ni Solicitudes, pero si el registro; MOD PO/SO y PO/SO
//          sin rol ven las suyas (Mis solicitudes); sin acceso, nada; ningun
//          "+" suelto en el menu y nadie con rol cae en Nueva solicitud al
//          entrar.
//
// Como correrla (desde la raiz del repositorio):
//
//   node tools\tests\NavegacionIniciativasHeadlessSmoke.js   # sale 0 si todo paso
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

// Lo que contesta admin_sesion en cada estado (los del servidor de verdad).
var SESIONES = {
  adm: { autorizado: true, rol: 'ADM', solicitante: true },
  mod: { autorizado: true, rol: 'MOD', solicitante: false },
  modposo: { autorizado: true, rol: 'MOD', solicitante: true },
  poso: { autorizado: false, solicitante: true },
  nada: { autorizado: false, solicitante: false },
  // dbo.UsuariosAdmin no se pudo leer; PO/SO + interruptor si.
  incierto: { autorizado: false, solicitante: true, verificacion: 'incompleta' },
  // Empieza ADM; la sonda lo cambia a poso con la pagina abierta.
  perdida: { autorizado: true, rol: 'ADM', solicitante: true }
};

// El catalogo minimo de Nueva solicitud (una ruta): basta para que exista
// el borrador y se pinten sus campos comunes.
var CATALOGO = { tipos: [{ prefijo: 'PRB', nombre: 'Problem' }], tipo_problem: 'PRB',
  rutas: [{ director: 'Dir A', po: 'PO 1', so: 'SO x', categoria: '/A/Cat 1' }],
  rutas_sin_duenos: 0, rutas_duenos_no_vigentes: 0 };

// window.__estado (de ?caso=) decide admin_sesion; los handlers de Admin
// responden 403 si el estado no es ADM/MOD, y los cuatro de Nueva solicitud
// si ademas no es solicitante (como el servidor).
var ANTES = '<script>\n' +
  'window.__SES = ' + JSON.stringify(SESIONES) + ';\n' +
  'window.__estado = new URLSearchParams(location.search).get("caso");\n' +
  'window.__sesiones = 0;\n' +
  'window.fetch = function (u) { u = String(u && u.url || u); var st = 200, j = {}, s = window.__SES[window.__estado];\n' +
  '  var nueva = /admin_iniciativas_(catalogos|capacidad|volumetria|validar)/.test(u);\n' +
  '  if (/admin_sesion\\.ashx/.test(u)) { window.__sesiones++; j = s || {}; }\n' +
  '  else if (/admin_iniciativas_mis_solicitudes/.test(u)) { window.__mias = (window.__mias || 0) + 1;\n' +
  '    if (s.solicitante && !s.verificacion) j = { solicitudes: [{ numero: 7, numero_texto: "#0000007", titulo: "Mia", estado: "ENVIADA" }], total: 1, maximo: 200 };\n' +
  '    else { st = 403; j = { error: "x", tipo: "AccesoDenegado" }; } }\n' +
  '  else if (/handlers\\/admin_/.test(u) && !s.autorizado && !(nueva && s.solicitante && !s.verificacion)) { st = 403; j = { error: "x", tipo: "AccesoDenegado" }; }\n' +
  '  else if (/admin_iniciativas_catalogos/.test(u)) j = ' + JSON.stringify(CATALOGO) + ';\n' +
  '  else if (/admin_iniciativas_solicitudes/.test(u)) j = s.rol === "ADM" ? { solicitudes: [], total: 0 } : (st = 403, { error: "x" });\n' +
  '  return new Promise(function (r) { setTimeout(function () { r({ ok: st === 200, status: st,\n' +
  '    json: function () { return Promise.resolve(j); }, text: function () { return Promise.resolve(JSON.stringify(j)); } }); }, 10); }); };\n' +
  'Element.prototype.scrollIntoView = function () {};\n' +
  '</script>\n';

function sondaTablero() {
  var R = [];
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function apunta(caso, v) { R.push([caso, v]); }
  // Las entradas que no son modulos (sin data-tab) y se ven.
  function visibles() {
    return Array.prototype.filter.call(document.querySelectorAll('.lateral .mnav:not([data-tab])'), function (a) {
      return !a.closest('li').hidden;
    }).map(function (a) { return a.id; });
  }
  function nombre(id) {
    var a = document.getElementById(id), t = a.querySelector('.mnav-txt');
    return [a.title, getComputedStyle(t).display === 'none' ? '' : t.textContent.trim()];
  }
  (async function () {
    try {
      await espera(2500);   // admin_sesion + el unico reintento (1500 ms)
      apunta('vis', visibles());
      apunta('preguntas', window.__sesiones);
      document.documentElement.classList.add('lateral-cerrada');
      apunta('plegada', visibles().map(nombre));
      document.documentElement.classList.remove('lateral-cerrada');
      apunta('desplegada', visibles().map(nombre));
      if (window.__estado === 'incierto') {
        window.__estado = 'poso';
        document.getElementById('mnav-sesion-reintentar').click();
        await espera(300);
        apunta('tras reintentar', visibles());
      }
    } catch (e) { apunta('error', String(e)); }
    var pre = document.createElement('pre'); pre.id = '__res';
    pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  })();
}

function sondaAdmin() {
  var R = [];
  function espera(ms) { return new Promise(function (ok) { setTimeout(ok, ms); }); }
  function apunta(caso, v) { R.push([caso, v]); }
  function oculto(id) { var el = document.getElementById(id); return !el || el.hidden || el.offsetParent === null; }
  // Las dos entradas se llaman igual: el prefijo dice cual se ve.
  function menu() {
    return Array.prototype.filter.call(document.querySelectorAll('.lateral li[data-solo-admin], .lateral li[data-solo-solicitante]'), function (li) {
      return !li.hidden;
    }).map(function (li) {
      var a = li.querySelector('a');
      return (li.hasAttribute('data-solo-admin') ? 'adm:' : 'sol:') + a.title + (a.getAttribute('aria-current') === 'page' ? '*' : '');
    });
  }
  function foto() {
    return { menu: menu(), tabs: !oculto('iniTabs'), ini: !oculto('panel-iniciativas'), nueva: !oculto('panel-nueva'),
      solicitar: !oculto('btnSolicitar'), denegado: !oculto('iniDenegado'), verificar: !oculto('iniVerificar'),
      pestanas: Array.prototype.filter.call(document.querySelectorAll('#iniTabs .ini-tab'), function (t) { return !t.hidden; })
        .map(function (t) { return t.textContent.trim(); }),
      mas: Array.prototype.some.call(document.querySelectorAll('.lateral li:not([hidden]) .mnav'), function (a) {
        return /M12 5v14/.test(a.innerHTML) || a.textContent.trim() === '+'; }),
      aviso: oculto('iniAvisoSesion') ? null : document.getElementById('iniAvisoSesion').textContent,
      duenos: !oculto('iniAvisoDuenos') };
  }
  (async function () {
    try {
      await espera(2500);
      apunta('inicio', foto());
      var caso = window.__estado;
      // Solicitudes por la pestaña y, si esta oculta, por llamada directa.
      var tab = document.getElementById('tab-solicitudes');
      if (tab && !tab.hidden) tab.click();
      else if (window.IniciativasPagina) window.IniciativasPagina.mostrarVista('solicitudes');
      await espera(300);
      apunta('solicitudes', { abierta: !oculto('panel-solicitudes'), cola: !oculto('solCola'), nota: !oculto('solNoAdm'),
        mias: !oculto('msBloque'), lista: (document.getElementById('msLista') || {}).textContent || '', pedidas: window.__mias || 0 });
      if (window.IniciativasPagina && !window.IniciativasPagina.denegada && !window.IniciativasPagina.verificacionPendiente) {
        window.IniciativasPagina.mostrarVista(window.IniciativasPagina.soloSolicitud ? 'nueva' : 'iniciativas');
        await espera(50);
      }
      if (caso === 'incierto') {
        window.__estado = 'adm';
        document.getElementById('iniVerificarReintentar').click();
        await espera(300);
        apunta('tras reintentar', foto());
      }
      if (caso === 'perdida') {
        // ADM con Nueva solicitud abierta y algo escrito.
        document.getElementById('btnSolicitar').click();
        await espera(100);
        var campo = document.querySelector('#iniCamposComunes textarea, #iniCamposComunes input[type="text"]');
        if (campo) { campo.value = 'Borrador a medias'; campo.dispatchEvent(new Event('input', { bubbles: true })); }
        var borrador = window.IniciativasPagina.solicitud;
        apunta('abierta', [foto().nueva, !!campo]);
        // Lo quitan de UsuariosAdmin (sigue siendo PO/SO); el siguiente
        // request de Admin es 403.
        window.__estado = 'poso';
        var antes = window.__sesiones;
        var r = await window.fetch('../handlers/admin_iniciativas_registro.ashx');
        await espera(300);
        apunta('403', [r.status, window.__sesiones - antes]);
        apunta('despues', foto());
        apunta('borrador', [campo ? campo.value : null, window.IniciativasPagina.solicitud === borrador]);
        apunta('sin recargar', performance.getEntriesByType('navigation').length);
      }
    } catch (e) { apunta('error', String(e)); }
    var pre = document.createElement('pre'); pre.id = '__res';
    pre.textContent = JSON.stringify({ r: R }); document.body.appendChild(pre);
  })();
}

var paginas = {
  '/__tablero.html': Banco.pagina('dashboard.html', 'assets/js/sesion-admin.js', ANTES, sondaTablero),
  '/admin/__ini.html': Banco.pagina('admin/iniciativas.html', '../assets/js/sesion-admin.js', ANTES, sondaAdmin)
};
var tablero = ['adm', 'mod', 'poso', 'nada', 'incierto'];
var admin = ['adm', 'mod', 'poso', 'nada', 'incierto', 'perdida', 'modposo'];

Banco.correr(paginas,
  tablero.map(function (c) { return '/__tablero.html?caso=' + c; }).concat(admin.map(function (c) { return '/admin/__ini.html?caso=' + c; })))
  .then(function (res) {
    var T = {}, A = {};
    tablero.forEach(function (c, i) { T[c] = Banco.mapa(res[i]); });
    admin.forEach(function (c, i) { A[c] = Banco.mapa(res[tablero.length + i]); });

    var INI = ['Iniciativas', 'Iniciativas'], PLEGADA = ['Iniciativas', ''];
    Check('D1 ADM: solo la entrada de ADM/MOD', ['mnav-admin'], T.adm.vis);
    Check('D1 ... se llama Iniciativas (plegada: title; desplegada: texto)', [[PLEGADA], [INI]], [T.adm.plegada, T.adm.desplegada]);
    Check('D2 MOD (sin PO/SO): solo la entrada de ADM/MOD', ['mnav-admin'], T.mod.vis);
    Check('D2 ... se llama Iniciativas', [[PLEGADA], [INI]], [T.mod.plegada, T.mod.desplegada]);
    Check('D3 PO/SO sin rol: solo la entrada del solicitante (nunca la de ADM/MOD)', ['mnav-solicitar'], T.poso.vis);
    Check('D3 ... plegada: sin texto, con title Iniciativas', [PLEGADA], T.poso.plegada);
    Check('D3 ... desplegada: el texto Iniciativas', [INI], T.poso.desplegada);
    Check('D4 sin rol ni PO/SO: nada', [], T.nada.vis);
    Check('D5 rol que falla (aunque diga solicitante): Reintentar, ninguna Iniciativas', ['mnav-sesion-reintentar'], T.incierto.vis);
    Check('D5 ... dos preguntas (un solo reintento automatico)', 2, T.incierto.preguntas);
    Check('D5 ... confirmadas, una sola', [1, 1, 1, 1], [T.adm.preguntas, T.mod.preguntas, T.poso.preguntas, T.nada.preguntas]);
    Check('D6 Reintentar con respuesta confirmada PO/SO: la entrada del solicitante', ['mnav-solicitar'], T.incierto['tras reintentar']);
    Check('D7 Reintentar plegado tiene title', [['No se pudo verificar tu acceso a Iniciativas. Reintentar', '']], T.incierto.plegada);
    Check('D7 sin errores en el tablero', [undefined, undefined, undefined, undefined, undefined],
      tablero.map(function (c) { return T[c].error; }));

    var a = A.adm.inicio, m = A.mod.inicio, p = A.poso.inicio, n = A.nada.inicio, inc = A.incierto.inicio;
    Check('A1 ADM: Iniciativas (ADM/MOD) activa, pestañas, Solicitar', [['adm:Iniciativas*'], true, true, true, false], [a.menu, a.tabs, a.ini, a.solicitar, a.denegado]);
    Check('A2 MOD sin PO/SO: Iniciativas (ADM/MOD), sin Solicitar', [['adm:Iniciativas*'], true, false], [m.menu, m.tabs, m.solicitar]);
    Check('A3 PO/SO sin rol: su entrada Iniciativas sigue (activa) al abrir la pagina; Nueva solicitud, sin la lista',
      [['sol:Iniciativas*'], true, true, false], [p.menu, p.tabs, p.nueva, p.ini]);
    Check('A3 ... el aviso de PO/SO en Nueva solicitud', true, p.duenos);
    Check('A4 sin nada: "sin acceso", ninguna entrada', [[], true, false, false], [n.menu, n.denegado, n.tabs, n.nueva]);
    Check('A5 incierto: Reintentar; ni modo solicitante ni "sin acceso"; ninguna entrada',
      [[], true, false, false, false, false], [inc.menu, inc.verificar, inc.denegado, inc.nueva, inc.ini, inc.tabs]);
    var r = A.incierto['tras reintentar'] || {};
    Check('A6 Reintentar y llega ADM: vuelve la pagina entera', [['adm:Iniciativas*'], false, true, true], [r.menu, r.verificar, r.tabs, r.ini]);

    var P = A.perdida;
    Check('P0 ADM con Nueva solicitud abierta y algo escrito', [true, true], P.abierta);
    Check('P1 sale de UsuariosAdmin: el 403 llega igual y se pregunta UNA vez a admin_sesion', [403, 1], P['403']);
    var d = P.despues || {};
    Check('P2 ... Nueva solicitud, la entrada Iniciativas del solicitante, sin la de ADM/MOD; pestañas Solicitar | Solicitudes',
      [['sol:Iniciativas*'], ['Solicitar una iniciativa', 'Solicitudes'], true, false, false], [d.menu, d.pestanas, d.nueva, d.ini, d.denegado]);
    Check('P2 ... con el aviso', true, /Ya no tienes acceso a la administración/.test(d.aviso || ''));
    Check('P3 ... lo escrito y el borrador intactos, sin recargar', [['Borrador a medias', true], 1], [P.borrador, P['sin recargar']]);
    Check('P3 sin errores en Admin', [undefined, undefined, undefined, undefined, undefined, undefined, undefined],
      admin.map(function (c) { return A[c].error; }));

    var mp = A.modposo.inicio, S = function (c) { return A[c].solicitudes || {}; };
    Check('S1 ADM: Solicitar y Solicitudes; la cola de ADM, sin Mis solicitudes',
      [['Iniciativas', 'Solicitudes', 'Administración'], true, true, true, false, 0],
      [a.pestanas, a.solicitar, S('adm').abierta, S('adm').cola, S('adm').mias, S('adm').pedidas]);
    Check('S2 MOD que no es PO/SO: ni Solicitar ni Solicitudes; el registro si (pestaña Iniciativas)',
      [['Iniciativas'], false, true], [m.pestanas, m.solicitar, m.ini]);
    Check('S2 ... ni por llamada directa se abre Solicitudes, ni se piden sus datos', [false, false, 0],
      [S('mod').abierta, S('mod').mias, S('mod').pedidas]);
    Check('S3 MOD PO/SO: Solicitar y Solicitudes; el registro sigue', [['Iniciativas', 'Solicitudes'], true, true],
      [mp.pestanas, mp.solicitar, mp.ini]);
    Check('S3 ... Solicitudes muestra las suyas (y la nota de la cola de ADM)', [true, false, true, true, true],
      [S('modposo').abierta, S('modposo').cola, S('modposo').nota, S('modposo').mias, /#0000007/.test(S('modposo').lista)]);
    Check('S4 PO/SO sin rol: pestañas Solicitar una iniciativa | Solicitudes', ['Solicitar una iniciativa', 'Solicitudes'], p.pestanas);
    Check('S4 ... Solicitudes muestra las suyas, sin la nota de ADM', [true, false, false, true, true],
      [S('poso').abierta, S('poso').cola, S('poso').nota, S('poso').mias, /#0000007/.test(S('poso').lista)]);
    Check('S5 sin acceso: ni pestañas ni Solicitudes, y no se piden', [false, false, 0],
      [n.tabs, S('nada').abierta, S('nada').pedidas]);
    Check('S5 incierto: Solicitudes no se abre', false, S('incierto').abierta);
    Check('S6 ningun "+" suelto en el menu', [false, false, false, false, false, false, false],
      admin.map(function (c) { return A[c].inicio.mas; }));
    Check('S7 ADM / MOD / MOD PO/SO entran al registro, nunca directo a Nueva solicitud', [false, false, false],
      [a.nueva, m.nueva, mp.nueva]);
    console.log(fallos === 0 ? 'TODO PASO' : fallos + ' FALLO(S)');
    process.exit(fallos === 0 ? 0 : 1);
  });
