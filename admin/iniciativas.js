/* =========================================================================
   admin/iniciativas.js

   Pagina oculta de administracion de iniciativas. Primer hito: pestañas de
   navegacion y, en "Nueva solicitud", los cuatro selects organizacionales
   encadenados. No envia ni guarda nada.

   LA CASCADA
   ----------
   Director -> Product Owner -> Service Owner -> Categoria.

   No hay un arbol de personas en la base: cada categoria vigente del
   catalogo de dueños tiene UN Director, UN Product Owner y UN Service Owner
   (heredados del C1 si su N2 no los trae; ver
   DirectorioOrganizacional.AsignacionesVigentes). La cascada es un filtro
   sobre esas filas: cada select ofrece solo los valores de las filas que
   cumplen TODO lo elegido arriba, asi que cualquier opcion lleva por lo
   menos a una categoria real. Director -> PO es la misma jerarquia de los
   selects del tablero; PO -> SO y SO -> Categoria no se inventan, salen de
   que compartan fila.

   El Manager NO entra: es otra jerarquia (Manager del Service Owner en
   CatPersona). El "Lider" de Backlog/QARE tampoco: es el de un Grupo
   (CatLiderGrupo), no el de una categoria.

   Dos partes:
     IniciativasCascada  logica pura, sin DOM (la prueba en node:
                         tools/tests/IniciativasCascadaSmoke.js)
     IniciativasPagina   el DOM: pestañas, carga, estados y selects
   ========================================================================= */
window.IniciativasCascada = (function () {
  'use strict';

  var NIVELES = [
    { clave: 'director',  etiqueta: 'Director' },
    { clave: 'po',        etiqueta: 'Product Owner' },
    { clave: 'so',        etiqueta: 'Service Owner' },
    { clave: 'categoria', etiqueta: 'Categoría' }
  ];

  function seleccionVacia() {
    return NIVELES.map(function () { return ''; });
  }

  // Filas que cumplen lo elegido en los niveles 0..hasta-1.
  function filasHasta(filas, seleccion, hasta) {
    return filas.filter(function (f) {
      for (var i = 0; i < hasta; i++) {
        if (seleccion[i] && f[NIVELES[i].clave] !== seleccion[i]) return false;
      }
      return true;
    });
  }

  // Valores distintos del nivel, ordenados como el directorio (ordinal).
  function opciones(filas, seleccion, nivel) {
    var vistos = {};
    var salida = [];
    filasHasta(filas, seleccion, nivel).forEach(function (f) {
      var v = f[NIVELES[nivel].clave];
      if (v && !Object.prototype.hasOwnProperty.call(vistos, v)) {
        vistos[v] = true;
        salida.push(v);
      }
    });
    return salida.sort(function (a, b) { return a < b ? -1 : a > b ? 1 : 0; });
  }

  // Elegir un valor limpia todos los niveles de abajo. Un valor que no esta
  // entre las opciones validas del nivel no se acepta (queda vacio).
  function elegir(filas, seleccion, nivel, valor) {
    var nueva = seleccion.slice();
    for (var i = nivel; i < NIVELES.length; i++) nueva[i] = '';
    if (valor && opciones(filas, nueva, nivel).indexOf(valor) >= 0) nueva[nivel] = valor;
    return nueva;
  }

  // Lo que pinta cada select: habilitado o no, sus opciones y, si esta
  // bloqueado o vacio, por que.
  function estado(filas, seleccion) {
    return NIVELES.map(function (n, i) {
      var padre = i > 0 ? NIVELES[i - 1] : null;
      if (padre && !seleccion[i - 1]) {
        return { habilitado: false, opciones: [], valor: '',
                 motivo: 'Elige primero un ' + padre.etiqueta + '.' };
      }
      var ops = opciones(filas, seleccion, i);
      if (!ops.length) {
        return { habilitado: false, opciones: [], valor: '',
                 motivo: padre ? 'Sin valores para el ' + padre.etiqueta + ' elegido.'
                               : 'Sin valores en el catálogo.' };
      }
      return { habilitado: true, opciones: ops, valor: seleccion[i], motivo: '' };
    });
  }

  // El JSON del handler -> filas validas. Descarta lo que no traiga los
  // cuatro campos como texto; no corrige ni inventa valores.
  function normalizar(json) {
    if (!json || !Array.isArray(json.asignaciones)) {
      throw new Error('La respuesta del servidor no trae el catálogo esperado.');
    }
    return json.asignaciones.filter(function (f) {
      return f && NIVELES.every(function (n) {
        return typeof f[n.clave] === 'string' && f[n.clave] !== '';
      });
    });
  }

  return { NIVELES: NIVELES, seleccionVacia: seleccionVacia, opciones: opciones,
           elegir: elegir, estado: estado, normalizar: normalizar };
})();

window.IniciativasPagina = (function () {
  'use strict';

  var C = window.IniciativasCascada;
  var URL_CATALOGO = '../handlers/admin_iniciativas_catalogos.ashx';
  var IDS = [
    { sel: 'selDirector',  mot: 'motDirector' },
    { sel: 'selPo',        mot: 'motPo' },
    { sel: 'selSo',        mot: 'motSo' },
    { sel: 'selCategoria', mot: 'motCategoria' }
  ];

  var filas = [];
  var seleccion = C.seleccionVacia();
  var cargaId = 0;       // descarta la respuesta de una carga ya superada

  function $(id) { return document.getElementById(id); }

  // ---- pestañas: solo navegacion ----
  function activarPestana(tab) {
    var tabs = document.querySelectorAll('.ini-tab');
    Array.prototype.forEach.call(tabs, function (t) {
      var activa = t === tab;
      t.classList.toggle('activa', activa);
      t.setAttribute('aria-selected', activa ? 'true' : 'false');
      t.tabIndex = activa ? 0 : -1;
      $(t.getAttribute('aria-controls')).hidden = !activa;
    });
  }

  function cablearPestanas() {
    var tabs = Array.prototype.slice.call(document.querySelectorAll('.ini-tab'));
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { activarPestana(t); });
      t.addEventListener('keydown', function (e) {
        var paso = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
        if (!paso) return;
        var sig = tabs[(i + paso + tabs.length) % tabs.length];
        activarPestana(sig);
        sig.focus();
      });
    });
  }

  // ---- selects ----
  function pintar() {
    var est = C.estado(filas, seleccion);
    est.forEach(function (e, i) {
      var sel = $(IDS[i].sel);
      Catalogos.llenar(sel, e.opciones, e.habilitado ? '— Elige —' : '—');
      sel.value = e.valor;
      sel.disabled = !e.habilitado;
      $(IDS[i].mot).textContent = e.motivo;
    });
  }

  // Todos bloqueados con el mismo motivo (cargando / error / vacio).
  function bloquearTodo(motivo) {
    IDS.forEach(function (ids) {
      var sel = $(ids.sel);
      Catalogos.llenar(sel, [], '—');
      sel.disabled = true;
      $(ids.mot).textContent = motivo;
    });
  }

  function cablearSelects() {
    IDS.forEach(function (ids, i) {
      $(ids.sel).addEventListener('change', function (e) {
        seleccion = C.elegir(filas, seleccion, i, e.target.value);
        pintar();
      });
    });
  }

  function mostrarError(texto) {
    $('iniErrorTexto').textContent = texto;
    $('iniError').hidden = false;
  }

  // ---- carga ----
  // `pedir` es fetch por omision; la prueba en navegador le pasa uno propio.
  function cargar(pedir) {
    pedir = pedir || function (url) { return fetch(url, { cache: 'no-store' }); };
    var mia = ++cargaId;

    filas = [];
    seleccion = C.seleccionVacia();
    $('iniError').hidden = true;
    $('iniOmitidas').hidden = true;
    $('iniEstado').textContent = 'Cargando catálogo organizacional…';
    bloquearTodo('Cargando…');

    return Promise.resolve()
      .then(function () {
        return Promise.resolve(pedir(URL_CATALOGO)).catch(function () {
          throw new Error('No se pudo conectar con el servidor.');
        });
      })
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (json) {
          if (!r.ok) {
            throw new Error((json && json.error) || ('El servidor respondió ' + r.status + '.'));
          }
          return json;
        });
      })
      .then(function (json) {
        if (mia !== cargaId) return;
        filas = C.normalizar(json);
        $('iniEstado').textContent = '';

        var omitidas = Number(json.omitidas) || 0;
        if (omitidas > 0) {
          $('iniOmitidas').textContent = omitidas + (omitidas === 1
            ? ' categoría vigente no aparece: le falta Director, Product Owner o Service Owner en el catálogo de dueños.'
            : ' categorías vigentes no aparecen: les falta Director, Product Owner o Service Owner en el catálogo de dueños.');
          $('iniOmitidas').hidden = false;
        }

        if (!filas.length) {
          $('iniEstado').textContent = 'No hay categorías vigentes con Director, Product Owner y Service Owner.';
          bloquearTodo('Sin valores en el catálogo.');
          return;
        }
        pintar();
      })
      .catch(function (err) {
        if (mia !== cargaId) return;
        filas = [];
        $('iniEstado').textContent = '';
        bloquearTodo('No disponible: no se pudo cargar el catálogo.');
        mostrarError((err && err.message) || 'No se pudo cargar el catálogo.');
      });
  }

  function iniciar() {
    cablearPestanas();
    cablearSelects();
    $('iniReintentar').addEventListener('click', function () { cargar(); });
    return cargar();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }

  return { cargar: cargar };
})();
