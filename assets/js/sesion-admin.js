/* SesionAdmin — que puede ver de Admin quien esta mirando la pagina.

   Pregunta a handlers/admin_sesion.ashx y:
     - muestra los elementos marcados con data-solo-admin (la entrada
       Administracion del menu) si la cuenta Windows esta autorizada;
     - muestra los marcados con data-solo-adm (p. ej. "+ Solicitar una
       iniciativa") solo si ademas el servidor dice rol "ADM"
       (dbo.UsuariosAdmin). MOD, sin rol o cualquier fallo: ocultos;
     - con { persona: true }, pinta "Bienvenido, <Nombre>" en el elemento
       que se le pase, solo si el servidor resolvio el nombre.

   ES SOLO UX. La seguridad esta en el servidor (AccesoAdmin.Exigir y
   AdminAccesoModulo): ocultar la entrada no protege nada, y mostrarla
   tampoco da acceso. Cualquier fallo (sin servidor, MOCK_DATA, 500) deja todo
   oculto y en silencio: nunca un error a la vista ni un nombre inventado. */
(function (global) {
  'use strict';

  class SesionAdmin {
    // base: ruta relativa a la raiz del sitio ('' en dashboard.html,
    // '../' en admin/). pedir: fetch por omision; las pruebas pasan uno propio.
    constructor(base, pedir) {
      this.url = (base || '') + 'handlers/admin_sesion.ashx';
      this.pedir = pedir || function (url) { return fetch(url, { cache: 'no-store' }); };
    }

    // -> Promise<{ autorizado: bool, nombre: string|null }>. Nunca rechaza.
    consultar(opciones) {
      var persona = !!(opciones && opciones.persona);
      var url = this.url + (persona ? '?persona=1' : '');
      return Promise.resolve()
        .then(() => this.pedir(url))
        .then(function (r) { return r && r.ok ? r.json() : null; })
        .then(function (json) {
          var nombre = json && typeof json.nombre === 'string' && json.nombre.trim()
            ? json.nombre.trim() : null;
          var autorizado = !!(json && json.autorizado === true);
          var rol = autorizado && (json.rol === 'ADM' || json.rol === 'MOD') ? json.rol : null;
          return { autorizado: autorizado, nombre: nombre, rol: rol };
        })
        .catch(function () { return { autorizado: false, nombre: null, rol: null }; });
    }

    // Muestra/oculta [data-solo-admin] dentro de raiz y, si se pasa,
    // pinta el saludo. Devuelve la misma promesa de consultar().
    aplicar(raiz, saludo) {
      var doc = raiz || global.document;
      return this.consultar({ persona: !!saludo }).then(function (s) {
        doc.querySelectorAll('[data-solo-admin]').forEach(function (el) {
          el.hidden = !s.autorizado;
        });
        doc.querySelectorAll('[data-solo-adm]').forEach(function (el) {
          el.hidden = s.rol !== 'ADM';
        });
        if (saludo) {
          saludo.textContent = s.autorizado && s.nombre ? 'Bienvenido, ' + s.nombre : '';
          saludo.hidden = !(s.autorizado && s.nombre);
        }
        return s;
      });
    }
  }

  global.SesionAdmin = SesionAdmin;
})(typeof window !== 'undefined' ? window : globalThis);
