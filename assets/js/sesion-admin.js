/* SesionAdmin — que puede ver de Admin quien esta mirando la pagina.

   Pregunta a handlers/admin_sesion.ashx y:
     - muestra los elementos marcados con data-solo-admin (la entrada
       Administracion del menu) si la cuenta Windows esta autorizada;
     - muestra los marcados con data-solo-adm (p. ej. "+ Crear
       iniciativa") solo si ademas el servidor dice rol "ADM"
       (dbo.UsuariosAdmin). MOD, sin rol o cualquier fallo: ocultos.
       "Solicitar una iniciativa" va con data-solo-admin: autorizado ya
       implica rol ADM o MOD en el servidor (AccesoAdmin.PuedeEntrar);
     - muestra los marcados con data-solo-solicitante (la entrada
       Iniciativas del menu) solo si el servidor dice solicitante: true y
       NO autorizado: una cuenta sin rol con el interruptor
       INICIATIVAS_ABIERTAS encendido (AccesoIniciativas). ADM/MOD siguen
       viendo Administracion;
     - con { persona: true }, pinta "Bienvenido, <Nombre>" en el elemento
       que se le pase, solo si el servidor resolvio el nombre, y el correo
       (dbo.UsuariosAdmin.CorreoUsuario) en el otro, solo si el servidor lo
       mando. Nunca se arma un correo aqui.

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

    // -> Promise<{ autorizado, solicitante, nombre, rol, correo }>. Nunca rechaza.
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
          // ADM/MOD siempre pueden solicitar; los demas solo si el servidor
          // lo dice con un true de verdad.
          var solicitante = autorizado || !!(json && json.solicitante === true);
          var rol = autorizado && (json.rol === 'ADM' || json.rol === 'MOD') ? json.rol : null;
          // Solo un correo con forma de correo; el servidor ya lo filtra.
          var correo = autorizado && typeof json.correo === 'string' && /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(json.correo.trim())
            ? json.correo.trim() : null;
          return { autorizado: autorizado, solicitante: solicitante, nombre: nombre, rol: rol, correo: correo };
        })
        .catch(function () { return { autorizado: false, solicitante: false, nombre: null, rol: null, correo: null }; });
    }

    // Muestra/oculta [data-solo-admin] dentro de raiz y, si se pasan,
    // pinta el saludo y el correo. Devuelve la misma promesa de consultar().
    aplicar(raiz, saludo, correo) {
      var doc = raiz || global.document;
      return this.consultar({ persona: !!(saludo || correo) }).then(function (s) {
        doc.querySelectorAll('[data-solo-admin]').forEach(function (el) {
          el.hidden = !s.autorizado;
        });
        doc.querySelectorAll('[data-solo-adm]').forEach(function (el) {
          el.hidden = s.rol !== 'ADM';
        });
        doc.querySelectorAll('[data-solo-solicitante]').forEach(function (el) {
          el.hidden = !(s.solicitante && !s.autorizado);
        });
        if (saludo) {
          saludo.textContent = s.solicitante && s.nombre ? 'Bienvenido, ' + s.nombre : '';
          saludo.hidden = !(s.solicitante && s.nombre);
        }
        if (correo) {
          correo.textContent = s.autorizado && s.correo ? s.correo : '';
          correo.hidden = !(s.autorizado && s.correo);
        }
        return s;
      });
    }
  }

  global.SesionAdmin = SesionAdmin;
})(typeof window !== 'undefined' ? window : globalThis);
